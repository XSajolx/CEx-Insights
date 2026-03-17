-- 1. Create the agent name mapping table
CREATE TABLE IF NOT EXISTS agent_name_mapping (
    id SERIAL PRIMARY KEY,
    intercom_name TEXT UNIQUE NOT NULL,
    agent_name TEXT NOT NULL,
    channel TEXT DEFAULT 'chat',
    exclude_from_metrics BOOLEAN DEFAULT false
);

-- Add new columns if table already exists
ALTER TABLE agent_name_mapping ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'chat';
ALTER TABLE agent_name_mapping ADD COLUMN IF NOT EXISTS exclude_from_metrics BOOLEAN DEFAULT false;

-- 2. Insert Chat agents (main team)
INSERT INTO agent_name_mapping (intercom_name, agent_name, channel, exclude_from_metrics) VALUES
('Andrew Clarkson', 'Tahseen Tayeb Kabir', 'chat', false),
('Annie Jane', 'Sayema Nawshin Rahman Aroni', 'chat', false),
('Arya Blossom', 'Nushrat Hasan', 'chat', false),
('Ashley Stinson', 'Ashika Rahman', 'chat', false),
('Austin Parker', 'Ashraful Islam', 'chat', false),
('Brandon Taylor', 'Rafi Bin Zahid', 'chat', false),
('Bella Calhoun', 'Nusrat Jahan Bidhe', 'chat', false),
('Casey Cooper', 'Elias Arman Bappi', 'chat', false),
('Daniel Cruz', 'Darren Perera', 'chat', false),
('Emma Sinclair', 'Jessica Dehoedt', 'chat', false),
('Grace Bexley', 'Rakibul Hasan Remon', 'chat', false),
('Henry Hudson', 'Md. Hasebul Hossain Prantik', 'chat', false),
('James Preston', 'Md Riad Hasan Munsi', 'chat', false),
('Jasone Clark', 'Rahat Rafsan', 'chat', false),
('Jax Volt', 'Ryan Patternot', 'chat', false),
('Jay Dawson', 'Samik Ahmed Eshti', 'chat', false),
('Jay Walker', 'Jake Devadason', 'chat', false),
('Jeff Bloom', 'Shazid Hossain', 'chat', false),
('John Tyson', 'Subitshan Chandramohan', 'chat', false),
('Josh Bennett', 'Shadrib Hasan Anik', 'chat', false),
('Katherine Pierce', 'Maisha Mahzabeen Zaara', 'chat', false),
('Leah Parker', 'Lamira Ajrin', 'chat', false),
('Lian Carter', 'Shadrach Jayasinghe', 'chat', false),
('Max Turner', 'Mainuzzaman Tarek', 'chat', false),
('Lyra Lopez', 'Md. Faisal Niyam', 'chat', false),
('Lauren Christie', 'Zuhra Mahjabin Sristy', 'chat', false),
('Mark Flair', 'Rajeen Morshed Fida', 'chat', false),
('Mark Scout', 'MD. OBAIDUR RAHMAN DIP', 'chat', false),
('Mel Hartlen', 'Mishelle Fernando', 'chat', false),
('Michael Spencer', 'Matheesha Santhush', 'chat', false),
('Natalia Delphine', 'Showmik Gaznabi', 'chat', false),
('Penny Reed', 'Md. Zunaid', 'chat', false),
('Ralph Bennett', 'Rayan Alahakoon', 'chat', false),
('Ray Newman', 'Md. Rawnak Islam', 'chat', false),
('Rex Mayhew', 'Robiul Hassan Labib', 'chat', false),
('Ryan Reed', 'Raiyan Intesar Anabil Talukder', 'chat', false),
('Rayan Shaw', 'Reyashad Ahamed Shanto', 'chat', false),
('Richard Thomas', 'Rabit Al Hassan', 'chat', false),
('Ruby Foster', 'Rumanta Hossain Mow', 'chat', false),
('Ryk Hayes', 'Tariqul Islam', 'chat', false),
('Sam Watson', 'Md. Rafi Hasan', 'chat', false),
('Samy Zayn', 'Raqibul Islam', 'chat', false),
('Selena Mercer', 'Al-Zawad Islam Shadman', 'chat', false),
('Seth Weston', 'Sithil Waduge', 'chat', false),
('Skylar Maddison', 'Ashraful Zannat Nourin', 'chat', false),
('Stephen Brooks', 'Samy Shams Sajid', 'chat', false),
('Steve Harrison', 'Mahathir Pablo Uday', 'chat', false),
('Tazien Morgan', 'Md.Tanjin ul Hoque', 'chat', false),
('Thea Quinn', 'Shaklain Mohammed Sifath', 'chat', false),
('Tom Matthew', 'Raiyan Ramim', 'chat', false),
('Zach Miller', 'Fatin Farhan Juboraj', 'chat', false),
('Zachery Ron', 'Abdullah Al Jubair', 'chat', false),
('Zara Monroe', 'Umme Salma Jui', 'chat', false),
('Zane Hayden', 'Chowdhury Zayed Hyder', 'chat', false),
('Zofia Meier', 'Marzahan Sarker Momo', 'chat', false),
('Axel Frost', 'Pingkon Augustine Rozario', 'chat', false),
('Cloe Rhodes', 'Mobasshira Islam', 'chat', false),
('David Zane', 'Prince Zakaria', 'chat', false),
('Elizabeth Holmes', 'Md. Khalid Hasan', 'chat', false),
('Ethan Maxwell', 'Dewan MD Rubayet Rafit', 'chat', false),
('Eva Wilson', 'Afifa Islam Fiha', 'chat', false),
('Fiona Clarke', 'Prottoy Saha', 'chat', false),
('Frank Taylor', 'Md Farhan Taher Oishik', 'chat', false),
('Liam Turner', 'Kithmal Wickramasingha', 'chat', false),
('Lina Hart', 'Seleena Leard', 'chat', false),
('Luke Hall', 'Samiul Sakib Rafin', 'chat', false),
('Lydia Algard', 'Hasnain', 'chat', false),
('Macy Snow', 'Md. Sadman', 'chat', false),
('Mark Walter', 'Abidur Rahman', 'chat', false),
('Mason Bradford', 'Meshak Abedin', 'chat', false),
('Noah Williams', 'Abishek Sasikumar', 'chat', false),
('Olivia Harper', 'Rifa Shadia Islam Prova', 'chat', false),
('Razor Frost', 'Rizny Azmy', 'chat', false),

-- Email-only agents
('Camilla Hansley', 'Sadman Sakib Ayon', 'email', false),
('Ella Romanoff', 'Maymona Ameen Kotwal Sidrah', 'email', false),
('Emilia Lavan', 'Nadia Muslim', 'email', false),
('Garry Carlsen', 'Galib Hasan Nizum', 'email', false),
('Harry Ackerman', 'Mehedi Hasan Sany', 'email', false),
('Jasper Ford', 'Sadman Islam Hridoy', 'email', false),
('Max Smith', 'Momen Hossain', 'email', false),
('Nathan West', 'Md Kamrul Hasan', 'email', false),
('Owen Matthews', 'Nuhash Rose Dhrubo', 'email', false),
('Paisley Wayne', 'Pafsin Akter Prithy', 'email', false),
('Sasha Zoe', 'Sana Amin Kotwal', 'email', false),
('Theo Barrett', 'Tazwar Fardous', 'email', false),
('Victor Hill', 'Asif Hasan Abir', 'email', false),
('Zeke Elric', 'Zawad Zarir Pasha', 'email', false),

-- Agents excluded from FRT/ART metrics
('Aiden Garcia', 'Nasif Ul Islam', 'chat', true),
('Ben Clark', 'M. I. Fahim Alam', 'chat', true),
('Danny Archer', 'M. M Abir Ahmed Mugdho', 'chat', true),
('Ember Lynn', 'Sheikh Shahariar Shohag', 'chat', true),
('Fredy Martinez', 'Faiyaz Muhtasim Ahmed', 'chat', true),
('Jack Carter', 'Izaz Ahmed Fuad', 'chat', true),
('Jane Megan', 'Jerin Tasneem Prova', 'chat', true),
('Prina Isabella', 'Nasrin Hossain Preya', 'chat', true),
('Ricky Ron', 'Md. Rakib Hossain', 'chat', true),
('Sammy Sage', 'Md. M Z Mahiuddin Shameem', 'chat', true),
('Sandro Jerome', 'S.M. Sourov Sagor', 'chat', true),
('Tyson Mayne', 'Manish Sarkar', 'chat', true),
('Willium Grace', 'Abir Hasan Pial', 'chat', true),
('Zoe Castillo', 'MD Nayeem Hossain', 'chat', true)
ON CONFLICT (intercom_name) DO UPDATE SET
    agent_name = EXCLUDED.agent_name,
    channel = EXCLUDED.channel,
    exclude_from_metrics = EXCLUDED.exclude_from_metrics;

-- 3. Add agent_name column to Service Performance Overview (if not exists)
ALTER TABLE "Service Performance Overview"
    ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- 4. Populate agent_name from the mapping
UPDATE "Service Performance Overview" spo
SET agent_name = m.agent_name
FROM agent_name_mapping m
WHERE spo.action_performed_by = m.intercom_name
  AND (spo.agent_name IS NULL OR spo.agent_name != m.agent_name);

-- 5. Also update Email - Service Performance Overview
ALTER TABLE "Email - Service Performance Overview"
    ADD COLUMN IF NOT EXISTS agent_name TEXT;

UPDATE "Email - Service Performance Overview" spo
SET agent_name = m.agent_name
FROM agent_name_mapping m
WHERE spo.action_performed_by = m.intercom_name
  AND (spo.agent_name IS NULL OR spo.agent_name != m.agent_name);

-- 6. Also update FIN - Service Performance Overview
ALTER TABLE "FIN - Service Performance Overview"
    ADD COLUMN IF NOT EXISTS agent_name TEXT;

UPDATE "FIN - Service Performance Overview" spo
SET agent_name = m.agent_name
FROM agent_name_mapping m
WHERE spo.action_performed_by = m.intercom_name
  AND (spo.agent_name IS NULL OR spo.agent_name != m.agent_name);
