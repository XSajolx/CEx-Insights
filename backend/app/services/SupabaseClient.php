<?php

class SupabaseClient
{
    private $supabaseUrl;
    private $supabaseKey;

    public function __construct()
    {
        $this->supabaseUrl = 'https://iktqpjwoahqycvlmstvx.supabase.co';
        $this->supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlrdHFwandvYWhxeWN2bG1zdHZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDI2MzQ1MiwiZXhwIjoyMDc5ODM5NDUyfQ.Pz1Yx5fj-rWoI9Xw3tosxOVKNb4su6_LRA3XV-S1ugc';
    }

    public function query($table, $select = '*', $filters = [])
    {
        $url = $this->supabaseUrl . '/rest/v1/' . $table . '?select=' . urlencode($select);

        // Add filters
        foreach ($filters as $key => $value) {
            if (is_array($value)) {
                // Handle operators like gte, lte, eq
                $operator = $value['operator'] ?? 'eq';
                $url .= '&' . $key . '=' . $operator . '.' . urlencode($value['value']);
            } else {
                $url .= '&' . $key . '=eq.' . urlencode($value);
            }
        }

        // Add limit to avoid fetching too much data at once
        if (!isset($filters['limit'])) {
            $url .= '&limit=10000';
        }

        error_log("Supabase Query URL: " . $url);

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'apikey: sb_publishable_xW4EafsrAvJl-8J_-xn0Qw_u3PEEOXj',
            'Authorization: Bearer ' . $this->supabaseKey,
            'Content-Type: application/json',
            'Prefer: return=representation'
        ]);

        // Disable SSL verification for local development
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

        if (curl_errno($ch)) {
            $error = curl_error($ch);
            error_log("Supabase cURL error: " . $error);
            curl_close($ch);
            return [];
        }

        curl_close($ch);

        error_log("Supabase Response (HTTP $httpCode): " . substr($response, 0, 500));

        if ($httpCode !== 200) {
            error_log("Supabase query failed (HTTP $httpCode): " . $response);
            return [];
        }

        $decoded = json_decode($response, true);
        if ($decoded === null) {
            error_log("Failed to decode JSON response: " . json_last_error_msg());
            return [];
        }

        error_log("Supabase returned " . count($decoded) . " rows");
        return $decoded;
    }
}
