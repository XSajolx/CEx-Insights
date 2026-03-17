# Service Performance Overview - Complete Column Data Logic Documentation

## Table: "Service Performance Overview"

This document describes the data source and calculation logic for **every column** in the "Service Performance Overview" table. Columns are organized by category.

---

## 📋 All Columns (24 Currently Synced)

### 🔑 Identification & Timestamps

#### 1. **conversation_id** (TEXT)
- **Source**: Intercom API
- **Logic**: `String(conv.id)` - Direct mapping from Intercom conversation ID
- **Data Type**: TEXT
- **Nullable**: NO (with unique constraint, but now allows multiple rows per conversation_id with different assignee_id)
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:336`
- **Notes**: 
  - Unique identifier for the conversation
  - With multi-agent support: Multiple rows can have the same conversation_id (one per agent)
  - Composite unique key: `(conversation_id, assignee_id)`

#### 2. **created_at** (TIMESTAMPTZ)
- **Source**: Intercom API
- **Logic**: `new Date(conv.created_at * 1000).toISOString()` - Converts Unix timestamp to ISO string
- **Data Type**: TIMESTAMPTZ
- **Nullable**: NO
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:337`
- **Notes**: When the conversation was created in Intercom (conversation-level, not agent-level)

#### 3. **updated_at** (TIMESTAMPTZ)
- **Source**: Intercom API
- **Logic**: `conv.updated_at ? new Date(conv.updated_at * 1000).toISOString() : null`
- **Data Type**: TIMESTAMPTZ
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:338`
- **Notes**: Last update time of the conversation in Intercom (conversation-level, not agent-level)

#### 4. **synced_at** (TIMESTAMPTZ)
- **Source**: System-generated
- **Logic**: `new Date().toISOString()` - Current timestamp when record is synced
- **Data Type**: TIMESTAMPTZ (default: NOW())
- **Nullable**: NO
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:356`
- **Notes**: Timestamp when the record was last synced/updated in Supabase

---

### 📊 Conversation Metadata

#### 5. **state** (TEXT)
- **Source**: Intercom API
- **Logic**: `conv.state` - Direct mapping
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:339`
- **Possible Values**: `'open'`, `'closed'`, `'snoozed'`, etc.
- **Notes**: Current state of the conversation. Currently only syncing `'closed'` conversations

#### 6. **channel** (TEXT)
- **Source**: Intercom API
- **Logic**: 
  ```javascript
  let channel = conv.source?.type || 'unknown';
  if (channel === 'conversation') channel = 'live_chat';
  ```
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:310-311, 340`
- **Possible Values**: `'live_chat'`, `'email'`, `'messenger'`, `'twitter'`, `'unknown'`, etc.
- **Notes**: Communication channel used for the conversation

#### 7. **country** (TEXT)
- **Source**: Intercom API (Custom Attributes or Contact Attributes)
- **Logic**: 
  ```javascript
  let country = null;
  if (conv.custom_attributes?.country) {
      country = conv.custom_attributes.country;
  } else if (conv.contacts?.contacts?.[0]?.custom_attributes?.country) {
      country = conv.contacts.contacts[0].custom_attributes.country;
  }
  ```
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:313-319, 341`
- **Notes**: Country of the contact/customer. Checks conversation custom attributes first, then contact custom attributes

---

### 👤 Agent & Team Information

#### 8. **assignee_id** (TEXT)
- **Source**: Intercom API (Conversation Parts)
- **Logic**: Extracted from `part.author.id` for each agent who responded
  ```javascript
  function getAgentId(author) {
      if (!author || isBot(author)) return null;
      return author.id ? String(author.id) : (author.name || null);
  }
  ```
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:142-146, 229, 342`
- **Notes**: 
  - **NEW**: With multi-agent support, this is the ID of the specific agent who responded (from conversation parts)
  - Previously was `conv.assignee?.id` (conversation-level assignee)
  - Each row now represents one agent's participation in the conversation
  - Bots/FIN are excluded

#### 9. **assignee_name** (TEXT)
- **Source**: Intercom API (Admin Map + Conversation Parts)
- **Logic**: 
  ```javascript
  function getAgentName(author, adminMap) {
      if (!author || isBot(author)) return null;
      if (author.id && adminMap[author.id]) {
          return adminMap[author.id];
      }
      return author.name || null;
  }
  
  // Special handling for FIN
  if (assigneeName && (assigneeName.toLowerCase().includes('fundednext ai') || assigneeName.toLowerCase() === 'fin')) {
      assigneeName = 'FIN';
  }
  ```
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:148-165, 328-333, 343`
- **Notes**: 
  - **NEW**: Name of the specific agent who responded (from conversation parts)
  - Previously was the conversation-level assignee name
  - "FundedNext AI" or "FIN" is normalized to "FIN"
  - Fetched from adminMap (team members) or falls back to author.name

#### 10. **team_id** (TEXT)
- **Source**: Intercom API
- **Logic**: `conv.team_assignee_id ? String(conv.team_assignee_id) : null`
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:344`
- **Notes**: Team ID assigned to the conversation (conversation-level, not agent-level)

---

### ⏱️ Performance Metrics (Per Agent)

#### 11. **frt_seconds** (INTEGER)
- **Source**: Calculated from Intercom Conversation Parts
- **Logic**: 
  ```javascript
  // For each agent:
  // FRT = time from conversation start to this agent's first response
  if (agent.frt === null) {
      agent.frt = part.created_at - conversationCreatedAt;
  }
  ```
- **Data Type**: INTEGER (seconds)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:250-253, 345`
- **Notes**: 
  - **NEW**: First Response Time is calculated **per agent**
  - Time from conversation creation to **this specific agent's first response**
  - Only counts human agent responses (bots/FIN excluded)
  - Measured in seconds

#### 12. **art_seconds** (INTEGER)
- **Source**: Calculated from Intercom Conversation Parts
- **Logic**: 
  ```javascript
  // For each agent:
  // ART = Average of all response times after agent's FRT
  // ART event = time from user's last message to agent's response
  if (agent.frt !== null && agentUserMessageTime[agentId]) {
      const responseTime = part.created_at - agentUserMessageTime[agentId];
      if (responseTime > 0 && responseTime < 86400) { // 0 to 24 hours
          agent.artEvents.push(responseTime);
      }
  }
  
  // Calculate average
  if (agent.artEvents.length > 0) {
      art = Math.round(agent.artEvents.reduce((sum, t) => sum + t, 0) / agent.artEvents.length);
  }
  ```
- **Data Type**: INTEGER (seconds)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:265-273, 280-284, 346`
- **Notes**: 
  - **NEW**: Average Response Time is calculated **per agent**
  - Only counts responses **after the agent's FRT**
  - Requires a preceding user message
  - Excludes bot/FIN responses
  - Valid range: 0 to 86400 seconds (24 hours)
  - Measured in seconds

#### 13. **aht_seconds** (INTEGER)
- **Source**: Calculated from Intercom Conversation Parts
- **Logic**: 
  ```javascript
  // For each agent:
  // AHT = duration from agent's first response to agent's last response
  const aht = agent.lastResponseTime - agent.firstResponseTime;
  ```
- **Data Type**: INTEGER (seconds)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:286-287, 347`
- **Notes**: 
  - **NEW**: Average Handle Time is calculated **per agent**
  - Duration from **this agent's first response** to **this agent's last response**
  - Not the full conversation duration, but the agent's participation window
  - Measured in seconds

#### 14. **wait_time_seconds** (INTEGER)
- **Source**: Intercom API (Statistics)
- **Logic**: 
  ```javascript
  const waitTime = stats.time_to_assignment || stats.time_to_first_close || null;
  ```
- **Data Type**: INTEGER (seconds)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:177, 348`
- **Notes**: 
  - Time to assignment or first close (conversation-level metric)
  - Same value for all agents in the same conversation
  - Measured in seconds

#### 15. **avg_wait_time_seconds** (INTEGER)
- **Source**: Calculated from Intercom Conversation Parts
- **Logic**: 
  ```javascript
  // Time from "Connect to an agent" button click to agent assignment
  // Detects "Connect to an agent" message/button click
  if (part.body && bodyLower.includes('connect to an agent')) {
      connectToAgentTime = part.created_at;
  }
  
  // Detects assignment event
  if (part.part_type === 'assignment' || part.body.includes('Assignment:')) {
      assignmentTime = part.created_at;
  }
  
  // Calculate: assignmentTime - connectToAgentTime
  if (connectToAgentTime && assignmentTime && assignmentTime > connectToAgentTime) {
      avgWaitTime = assignmentTime - connectToAgentTime;
  }
  ```
- **Data Type**: INTEGER (seconds)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:214-263, 320-336, 349`
- **Notes**: 
  - **NEW**: Average Wait Time from bot transfer to agent assignment
  - Time from when user clicks "Connect to an agent" to when conversation is assigned to an agent
  - Falls back to first agent's first response if assignment event not found
  - Same value for all agents in the same conversation
  - Measured in seconds

#### 16. **frt_hit_rate** (INTEGER)
- **Source**: Calculated from FRT
- **Logic**: 
  ```javascript
  // FRT Hit Rate: 1 if FRT > 30 seconds, 0 if FRT <= 30 seconds
  let frtHitRate = null;
  if (agent.frt !== null) {
      frtHitRate = agent.frt > 30 ? 1 : 0;
  }
  ```
- **Data Type**: INTEGER (0 or 1)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:302-305, 350`
- **Notes**: 
  - **NEW**: FRT Hit Rate indicator
  - `1` = FRT exceeded 30 seconds (missed target)
  - `0` = FRT within 30 seconds (hit target)
  - Calculated per agent
  - Used for performance tracking

#### 17. **art_hit_rate** (INTEGER)
- **Source**: Calculated from ART
- **Logic**: 
  ```javascript
  // ART Hit Rate: 1 if ART > 60 seconds, 0 if ART <= 60 seconds
  let artHitRate = null;
  if (art !== null) {
      artHitRate = art > 60 ? 1 : 0;
  }
  ```
- **Data Type**: INTEGER (0 or 1)
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:307-310, 351`
- **Notes**: 
  - **NEW**: ART Hit Rate indicator
  - `1` = ART exceeded 60 seconds (missed target)
  - `0` = ART within 60 seconds (hit target)
  - Calculated per agent
  - Used for performance tracking

---

### 📈 Quality Metrics

#### 18. **sentiment** (TEXT)
- **Source**: Intercom API (Tags)
- **Logic**: 
  ```javascript
  let sentiment = null;
  if (conv.tags?.tags) {
      for (const tag of conv.tags.tags) {
          const name = (tag.name || '').toLowerCase();
          if (name.includes('positive') || name.includes('happy') || name.includes('satisfied')) {
              sentiment = 'Positive';
              break;
          } else if (name.includes('negative') || name.includes('angry') || name.includes('frustrated')) {
              sentiment = 'Negative';
              break;
          } else if (name.includes('neutral')) {
              sentiment = 'Neutral';
              break;
          }
      }
  }
  ```
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:179-195, 349`
- **Possible Values**: `'Positive'`, `'Neutral'`, `'Negative'`, `null`
- **Notes**: 
  - Extracted from conversation tags
  - Same value for all agents in the same conversation
  - Currently uses simple keyword matching on tag names

#### 19. **csat_rating** (INTEGER)
- **Source**: Intercom API (Conversation Rating)
- **Logic**: `conv.conversation_rating?.rating || null`
- **Data Type**: INTEGER
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:197-198, 350`
- **Possible Values**: `1`, `2`, `3`, `4`, `5`, `null`
- **Notes**: 
  - Customer Satisfaction rating (1-5 scale)
  - Same value for all agents in the same conversation
  - Conversation-level metric

---

### 📝 Response & Status Information

#### 20. **response_count** (INTEGER)
- **Source**: Calculated from Intercom Conversation Parts
- **Logic**: 
  ```javascript
  // For each agent:
  // Count number of responses by this agent
  agent.responseCount++; // Incremented for each admin comment by this agent
  ```
- **Data Type**: INTEGER
- **Nullable**: NO (default: 0)
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:247, 351`
- **Notes**: 
  - **NEW**: Number of responses by **this specific agent**
  - Previously was `conv.statistics?.count_admin_replies` (conversation-level)
  - Only counts human agent responses (bots/FIN excluded)
  - Only counts `part_type === 'comment'` responses

#### 21. **is_reopened** (BOOLEAN)
- **Source**: Intercom API (Statistics)
- **Logic**: `(conv.statistics?.count_reopens || 0) > 0`
- **Data Type**: BOOLEAN (default: FALSE)
- **Nullable**: NO
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:352`
- **Notes**: 
  - Indicates if the conversation was reopened
  - Same value for all agents in the same conversation
  - Conversation-level metric

#### 22. **reopened_count** (INTEGER)
- **Source**: Intercom API (Statistics)
- **Logic**: `conv.statistics?.count_reopens || 0`
- **Data Type**: INTEGER (default: 0)
- **Nullable**: NO
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:353`
- **Notes**: 
  - Number of times the conversation was reopened
  - Same value for all agents in the same conversation
  - Conversation-level metric

---

### 🔗 Contact & Tags

#### 23. **contact_id** (TEXT)
- **Source**: Intercom API (Contacts)
- **Logic**: `conv.contacts?.contacts?.[0]?.id ? String(conv.contacts.contacts[0].id) : null`
- **Data Type**: TEXT
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:354`
- **Notes**: 
  - ID of the contact/customer who initiated the conversation
  - Takes the first contact if multiple contacts are associated
  - Same value for all agents in the same conversation

#### 24. **tags** (JSONB)
- **Source**: Intercom API (Tags)
- **Logic**: `conv.tags?.tags ? JSON.stringify(conv.tags.tags.map(t => t.name)) : null`
- **Data Type**: JSONB
- **Nullable**: YES
- **Status**: ✅ Complete
- **Code Location**: `sync-to-supabase.js:355`
- **Notes**: 
  - Array of tag names associated with the conversation
  - Stored as JSON string
  - Same value for all agents in the same conversation
  - Used for sentiment extraction

---

## ⚠️ Missing Columns / To Be Added

The following columns may exist in the table but are **NOT currently being synced**. Please add logic for these:

### NEW_COLUMN_1 (DATA_TYPE)
- **Source**: [Where does this data come from?]
- **Logic**: [How is it calculated/extracted?]
- **Data Type**: [Type]
- **Status**: ❌ Missing Logic
- **Notes**: [Any additional notes]

### NEW_COLUMN_2 (DATA_TYPE)
- **Source**: [Where does this data come from?]
- **Logic**: [How is it calculated/extracted?]
- **Data Type**: [Type]
- **Status**: ❌ Missing Logic
- **Notes**: [Any additional notes]

---

## 📊 Summary

- **Total Columns Documented**: 24
- **Columns with Complete Logic**: 24
- **Columns Missing Logic**: [To be filled]

---

## 🔍 How to Check All Columns in Table

Run this SQL in Supabase SQL Editor:

```sql
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Service Performance Overview'
ORDER BY ordinal_position;
```

---

## 📝 Next Steps

1. ✅ All 21 currently synced columns are documented
2. ⚠️ Check the table for any additional columns
3. ⚠️ Add extraction/calculation logic for new columns
4. ⚠️ Update the sync script (`sync-to-supabase.js`) to include new columns
5. ⚠️ Update this document with new column logic

---

## 📅 Version History

- **Version 2.0** (2024-01-XX): Multi-Agent Support - One row per agent per conversation
- **Version 1.0**: Initial documentation

---

**Last Updated**: 2024-01-XX
