-- Phase 4: make exact cosine ranking fast enough to keep.
--
-- Purely a function replacement. No table, column, index, constraint or row is touched, so this
-- migration is safe to apply to a populated database and needs no reindex.
--
-- Why: the Phase 3 definition computed three separate correlated subqueries over the arrays
-- (dot product, and each vector's norm), each re-scanning via generate_subscripts. Measured on
-- PostgreSQL 17.4, that cost ~82 ms for 40 passages and ~1,666 ms for 800 — linear, and far too
-- slow to describe as "fast". See docs/RETRIEVAL.md for the before-and-after measurements.
--
-- This definition walks both arrays once, joining them on ordinality, and accumulates all three
-- sums in a single aggregate pass. Results are numerically identical; only the cost changes.
CREATE OR REPLACE FUNCTION opspilot_cosine_distance(a DOUBLE PRECISION[], b DOUBLE PRECISION[])
RETURNS DOUBLE PRECISION AS $$
    SELECT CASE
        WHEN array_length(a, 1) IS NULL
          OR array_length(b, 1) IS NULL
          OR array_length(a, 1) <> array_length(b, 1)
        THEN NULL
        ELSE (
            SELECT CASE
                WHEN norm_a = 0 OR norm_b = 0 THEN NULL
                ELSE 1 - (dot / (sqrt(norm_a) * sqrt(norm_b)))
            END
            FROM (
                SELECT COALESCE(sum(x.value * y.value), 0) AS dot,
                       COALESCE(sum(x.value * x.value), 0) AS norm_a,
                       COALESCE(sum(y.value * y.value), 0) AS norm_b
                  FROM unnest(a) WITH ORDINALITY AS x(value, position)
                  JOIN unnest(b) WITH ORDINALITY AS y(value, position) USING (position)
            ) sums
        )
    END
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
