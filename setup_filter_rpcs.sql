-- Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_intercom_topic_product ON "Intercom Topic" ("Product");
CREATE INDEX IF NOT EXISTS idx_intercom_topic_country ON "Intercom Topic" ("Country");

-- RPC to get Distinct Products
CREATE OR REPLACE FUNCTION get_intercom_products()
RETURNS TEXT[]
LANGUAGE sql
STABLE
AS $$
    SELECT ARRAY(
        SELECT DISTINCT "Product"
        FROM "Intercom Topic"
        WHERE "Product" IS NOT NULL AND "Product" != '' AND "Product" != 'EMPTY'
        ORDER BY "Product"
    );
$$;

-- RPC to get Distinct Countries
CREATE OR REPLACE FUNCTION get_intercom_countries()
RETURNS TEXT[]
LANGUAGE sql
STABLE
AS $$
    SELECT ARRAY(
        SELECT DISTINCT "Country"
        FROM "Intercom Topic"
        WHERE "Country" IS NOT NULL AND "Country" != '' AND "Country" != 'EMPTY'
        ORDER BY "Country"
    );
$$;
