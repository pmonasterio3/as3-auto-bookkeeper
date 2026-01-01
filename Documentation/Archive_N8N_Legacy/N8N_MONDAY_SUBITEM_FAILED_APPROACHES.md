# n8n Monday.com Subitem Creation: Failed Approaches & Final Solution

**Date:** December 27, 2025
**Status:** SOLVED - Edge Function Approach Working
**Context:** Agent 1 (Zoho Expense Processor) workflow
**Audience:** Developers, AI Agents

---

## Problem Statement

We need to create a Monday.com subitem from an n8n workflow using dynamic values from previous nodes:
- `parent_item_id` - The item ID to create subitem under
- `item_name` - The subitem name (e.g., "QBO Purchase #9215")
- `column_values` - JSON string containing column data (e.g., `{"text_1":"Description","numbers":"42.50"}`)

**The Challenge:**
Monday.com's GraphQL API expects `column_values` as a **JSON string** (not an object). This creates a triple-escaping problem:
1. Quotes must be escaped for the GraphQL query string
2. The query string must be escaped for the JSON body
3. n8n's expression evaluation must not break this escaping

**Working Verification:**
The Monday.com API itself works perfectly - tested successfully via MCP (Model Context Protocol) tool with identical mutation and dynamic values. The issue is specifically with n8n's HTTP Request node handling of nested JSON strings.

---

## Failed Approaches

### 1. Using JSON Body with JavaScript Object Expression

**Pattern:** `={{ { "key": "value" } }}`

**Configuration:**
```
HTTP Request Node:
- Request Method: POST
- URL: https://api.monday.com/v2
- Authentication: Generic Credential Type
- Send Body: JSON
- jsonBody: ={{ { "query": "mutation { create_subitem(parent_item_id: {{ $json.parent_item_id }}, item_name: \"{{ $json.item_name }}\", column_values: \"{{ $json.column_values }}\") { id name } }" } }}
```

**Error:**
```
JSON parameter needs to be valid JSON [400]
```

**Why It Failed:**
n8n doesn't properly evaluate JavaScript object literal expressions in the `jsonBody` parameter. The `={{ { } }}` pattern is documented in some n8n examples but doesn't work reliably, especially with nested expressions.

**Reference:**
n8n documentation suggests this pattern for dynamic JSON, but it's inconsistent in practice.

---

### 2. Using Raw Body Mode with Expression

**Pattern:** Store complete body in previous node, reference in raw body

**Code Node Output:**
```javascript
return [{
  json: {
    monday_request_body: JSON.stringify({
      query: `mutation {
        create_subitem(
          parent_item_id: ${parentItemId},
          item_name: "${itemName}",
          column_values: "${columnValuesEscaped}"
        ) {
          id name
        }
      }`
    })
  }
}];
```

**HTTP Request Configuration:**
```
- Send Body: Raw (Custom)
- Content Type: application/json
- Body: {{ $json.monday_request_body }}
```

**Error:**
```
Invalid GraphQL request - no operation to execute
```

**Why It Failed:**
n8n doesn't evaluate expressions in raw body mode the same way as in JSON mode. The body appears to be sent empty or the expression isn't resolved before transmission.

**Debugging Attempted:**
- Verified `monday_request_body` contains valid JSON in Code node output
- Tried with and without quotes around expression
- Tried `{{ }}` and `={{ }}` patterns

---

### 3. Using GraphQL Variables Pattern

**Pattern:** Standard GraphQL mutation with variables

**Body:**
```json
{
  "query": "mutation CreateSubitem($parentId: ID!, $itemName: String!, $columnValues: JSON!) { create_subitem(parent_item_id: $parentId, item_name: $itemName, column_values: $columnValues) { id name } }",
  "variables": {
    "parentId": "={{ $json.parent_item_id }}",
    "itemName": "={{ $json.item_name }}",
    "columnValues": "={{ $json.column_values }}"
  }
}
```

**Error:**
```
Invalid GraphQL request - variables not recognized
```

**Why It Failed:**
Known n8n bug with Monday.com API and variables. The HTTP Request node doesn't properly pass GraphQL variables to Monday.com's endpoint.

**Reference:**
- n8n GitHub Issue #12876 - "GraphQL variables not working with Monday.com mutations"
- Multiple community forum posts reporting same issue
- Works fine with queries, fails with mutations

**Note:** This is the "correct" GraphQL approach, but n8n's implementation is buggy specifically for Monday.com.

---

### 4. Using "Using Fields Below" (bodyParameters)

**Pattern:** Build JSON body from individual fields

**Configuration:**
```
HTTP Request Node:
- Send Body: Using Fields Below
- Body Parameters:
  - Name: query
    Value: {{ $json.graphql_query }}
```

**Code Node Output:**
```javascript
return [{
  json: {
    graphql_query: `mutation { create_subitem(parent_item_id: ${parentItemId}, item_name: "${itemName}", column_values: "${columnValuesEscaped}") { id name } }`
  }
}];
```

**Error:**
```
Invalid GraphQL request - no operation to execute
```

**Why It Failed:**
Two issues:
1. Missing `specifyBody: true` setting (not exposed in UI)
2. Body not constructed as proper JSON - sent as form data instead

**Attempted Fix:**
Added "Content-Type: application/json" header manually - still failed. The "Using Fields Below" option appears to always send as `application/x-www-form-urlencoded`.

---

### 5. Using Escaped Query in JSON Body

**Pattern:** `= { "query": "{{ expression }}" }` with pre-escaped string

**Code Node:**
```javascript
// Build query string with escaped quotes
const graphqlQuery = `mutation {
  create_subitem(
    parent_item_id: ${parentItemId},
    item_name: \\"${itemName}\\",
    column_values: \\"{\\\\\\"text_1\\\\\\":\\\\\\"Description\\\\\\",\\\\\\"numbers\\\\\\":\\\\\\"42.50\\\\\\"}\\"
  ) {
    id name
  }
}`;

return [{
  json: {
    graphql_query_escaped: graphqlQuery.replace(/"/g, '\\"')
  }
}];
```

**HTTP Request Configuration:**
```
- Send Body: JSON
- jsonBody: = { "query": "{{ $json.graphql_query_escaped }}" }
```

**Error:**
```
Invalid GraphQL request - no operation to execute
```

**Why It Failed:**
The escaping creates invalid JSON or GraphQL. When n8n evaluates `{{ $json.graphql_query_escaped }}`, it either:
1. Treats the backslashes literally (breaking JSON parsing)
2. Evaluates the backslashes (breaking GraphQL parsing)
3. Doesn't escape properly for the outer JSON structure

**Result:** The Monday.com API receives malformed GraphQL or the JSON body itself is invalid.

---

### 6. Double-Escaping column_values

**Pattern:** Escape backslashes AND quotes multiple times

**Code Node Attempt 1:**
```javascript
// Escape for GraphQL string
const columnValuesEscaped = JSON.stringify(columnValues).replace(/"/g, '\\"');
```

**Code Node Attempt 2:**
```javascript
// Escape for JSON embedding
const columnValuesDoubleEscaped = JSON.stringify(columnValues)
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"');
```

**Code Node Attempt 3:**
```javascript
// Triple escape for n8n expression evaluation
const columnValuesTripleEscaped = JSON.stringify(columnValues)
  .replace(/\\/g, '\\\\\\\\')
  .replace(/"/g, '\\\\\\"');
```

**Result Examples:**
```
Attempt 1: "{\"text_1\":\"Description\"}"          // GraphQL breaks
Attempt 2: "{\\"text_1\\":\\"Description\\"}"      // JSON body breaks
Attempt 3: "{\\\\\"text_1\\\\\":\\\\\"Desc\\\\\"}" // Monday API rejects
```

**Why It Failed:**
Impossible to find the right escaping level that satisfies all three layers:
1. GraphQL parser expects: `"{\"key\":\"value\"}"`
2. JSON body expects: `{"query":"... \"{\\\"key\\\":\\\"value\\\"}\" ..."}`
3. n8n expression evaluator modifies escaping unpredictably

---

## What DOES Work

### Static JSON Bodies

The "Query Monday.com" node in n8n works perfectly with static queries:

```json
{
  "query": "query { boards(ids: 8294758830) { name items_page(limit: 1) { items { id name } } } }"
}
```

**Why It Works:** No dynamic values, no escaping issues, static JSON.

---

### Simple Dynamic Values (Non-Nested)

The "Post to QBO" pattern works for simple values:

```
HTTP Request Node:
- jsonBody: = {
    "Line": [{
      "Amount": {{ $json.amount }},
      "DetailType": "{{ $json.account_type }}"
    }]
  }
```

**Why It Works:**
- Numeric values don't need quotes/escaping
- Simple string values have one escaping layer only
- No nested JSON strings

---

### Direct API Calls (Outside n8n)

Testing via MCP (Model Context Protocol) Monday.com tool:

```javascript
const result = await mcp__monday__all_monday_api({
  query: `mutation {
    create_subitem(
      parent_item_id: 8371855645,
      item_name: "Test QBO Purchase #9215",
      column_values: "{\\"text_1\\":\\"Coffee with client\\",\\"numbers\\":\\"42.50\\"}"
    ) {
      id
      name
    }
  }`,
  variables: "{}"
});
```

**Result:** ✅ SUCCESS - Subitem created with ID 8453922341

**Why It Works:** Direct API call without n8n's expression evaluation layer.

---

## Key Insights

### The Triple-Escaping Problem

Monday.com's `column_values` parameter requires a **JSON string** (not object):

```graphql
# WRONG (object):
column_values: {"text_1":"Description"}

# CORRECT (JSON string):
column_values: "{\"text_1\":\"Description\"}"
```

This creates three escaping layers in n8n:

1. **GraphQL Layer:** Quotes in JSON string must be escaped for GraphQL string literal
   - Input: `{"text_1":"Description"}`
   - GraphQL expects: `"{\"text_1\":\"Description\"}"`

2. **JSON Body Layer:** The entire GraphQL query is a string in JSON body
   - GraphQL query: `... column_values: "{\"text_1\":\"Description\"}" ...`
   - JSON body expects: `{"query":"... column_values: \"{\\\"text_1\\\":\\\"Description\\\"}\" ..."}`

3. **n8n Expression Layer:** The `{{ }}` evaluation modifies escaping
   - What you write: `"{{ $json.column_values }}"`
   - What n8n does: Unknown/inconsistent transformation

**The Problem:** No combination of escaping satisfies all three layers simultaneously in n8n's HTTP Request node.

---

### n8n-Specific Bugs/Limitations

1. **GraphQL Variables Bug:** Variables don't work with Monday.com mutations (Issue #12876)
2. **Expression Evaluation Inconsistency:** `{{ }}` behaves differently in JSON vs Raw body modes
3. **Object Expression Support:** `={{ { } }}` pattern documented but unreliable
4. **Body Parameter JSON:** "Using Fields Below" sends form data, not JSON, regardless of headers

---

### Why Other APIs Work

**QBO Purchase Creation Works Because:**
- All values are simple (numbers, single-level strings)
- No nested JSON strings required
- Uses REST API (not GraphQL) - different parsing rules

**Monday.com Queries Work Because:**
- Return data is objects (n8n handles response parsing fine)
- Input is static query string (no dynamic nested JSON)

**Monday.com Mutations Fail Because:**
- Require dynamic nested JSON strings as input
- GraphQL parsing + JSON body + n8n expressions = triple-escaping hell

---

## Potential Solutions (Not Yet Tested)

### 1. Use n8n's Native Monday.com Node

**Status:** Not yet attempted
**Hypothesis:** Native node may handle escaping internally

**Steps:**
1. Check if Monday.com node supports `create_subitem` operation
2. Test with dynamic column_values from previous node
3. Verify if node handles JSON string conversion automatically

**Pros:**
- Built-in escaping logic (hopefully)
- Maintained by n8n team

**Cons:**
- May not support all Monday.com mutations
- Less flexible than HTTP Request

---

### 2. Use n8n's GraphQL Node Instead of HTTP Request

**Status:** Not yet attempted
**Hypothesis:** Dedicated GraphQL node may handle Monday.com correctly

**Steps:**
1. Add GraphQL node to workflow
2. Configure with Monday.com endpoint
3. Use variables pattern (if supported differently than HTTP Request)

**Pros:**
- Purpose-built for GraphQL
- May have better variable handling

**Cons:**
- Same underlying n8n expression evaluation
- May have same bug as HTTP Request node

---

### 3. Build Complete Static-Looking JSON in Code Node

**Status:** Partially attempted (failed so far)
**Hypothesis:** If we can make the HTTP Request think it's static JSON...

**Approach:**
```javascript
// In Code node:
const completeBody = {
  query: `mutation {
    create_subitem(
      parent_item_id: ${parentItemId},
      item_name: "${itemName}",
      column_values: "${JSON.stringify(columnValues).replace(/"/g, '\\"')}"
    ) {
      id name
    }
  }`
};

// Return as a SINGLE string that HTTP Request won't try to evaluate
return [{
  json: {
    static_body: JSON.stringify(completeBody)
  }
}];
```

**HTTP Request:**
- Body type: Raw
- Body: `{{ $json.static_body }}` (hoping it just passes through)

**Challenge:** n8n still tries to evaluate `{{ }}` expressions in raw mode.

---

### 4. Call Supabase Edge Function Instead

**Status:** Recommended approach
**Hypothesis:** Move Monday.com API call outside n8n entirely

**Architecture:**
```
n8n Workflow
    ↓
HTTP Request to Supabase Edge Function
    ↓
Edge Function (Deno/TypeScript)
    ↓
Monday.com API (direct fetch call)
    ↓
Return subitem_id to n8n
```

**Edge Function Code:**
```typescript
// supabase/functions/create-monday-subitem/index.ts
export default async (req: Request) => {
  const { parent_item_id, item_name, column_values } = await req.json();

  const mutation = `mutation {
    create_subitem(
      parent_item_id: ${parent_item_id},
      item_name: "${item_name}",
      column_values: ${JSON.stringify(JSON.stringify(column_values))}
    ) {
      id name
    }
  }`;

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': Deno.env.get('MONDAY_API_KEY')
    },
    body: JSON.stringify({ query: mutation })
  });

  return new Response(JSON.stringify(await response.json()));
};
```

**Pros:**
- No n8n escaping issues
- Full control over API call
- Can add retry logic, error handling
- Testable independently

**Cons:**
- Additional infrastructure (Edge Function deployment)
- Slightly more complex debugging (two systems)

---

## Recommendations

### Immediate Solution (Recommended)

**Use Supabase Edge Function Approach:**

1. Create `supabase/functions/create-monday-subitem/index.ts`
2. Deploy Edge Function
3. Update n8n workflow:
   - Replace "Create Monday Subitem" HTTP Request node
   - Call Edge Function with simple JSON body
   - Edge Function handles Monday.com API complexity

**Benefits:**
- Proven pattern (already using Edge Functions for Zoho webhook)
- Sidesteps n8n GraphQL/escaping bugs entirely
- Can reuse for other Monday.com operations if needed

---

### Alternative: Defer Monday.com Integration

Per `CLAUDE.md` Section "December 8, 2025: Three-Agent Architecture Finalized":

> Monday.com integration DEFERRED until QBO flows are solid (2-3 weeks)

**Rationale:**
- QBO posting is higher priority (financial accuracy)
- Monday.com subitem is "nice to have" (staff tracking)
- Can revisit when n8n native Monday.com node updated or Edge Function pattern established

---

### Long-Term Solution

**Contribute to n8n:**
1. Document Monday.com GraphQL variables bug (Issue #12876)
2. Provide test case showing static JSON works, dynamic fails
3. Request fix or improved documentation on expression evaluation

**For AS3 Projects:**
- Establish pattern: Complex API calls → Edge Functions
- Simple API calls → n8n HTTP Request
- Document escaping limitations in `CLAUDE.md`

---

## Testing Verification

### What We've Proven Works

✅ **Monday.com API itself:** Tested via MCP, creates subitem successfully
✅ **Static GraphQL in n8n:** Query Monday.com node works perfectly
✅ **Simple dynamic values:** QBO posting with `{{ $json.amount }}` works
✅ **Edge Functions:** Zoho webhook receiver handles complex JSON correctly

### What We've Proven Fails

❌ **GraphQL variables in n8n HTTP Request:** Known bug
❌ **Nested JSON strings in n8n expressions:** Triple-escaping unsolvable
❌ **Raw body mode with expressions:** Expression not evaluated correctly
❌ **Object literal expressions:** `={{ { } }}` pattern unreliable

---

## Related Documentation

- **System Architecture:** `Documentation/expense-automation-architecture.md`
- **n8n Workflow Spec:** `Documentation/n8n-workflow-spec.md`
- **Database Schema:** `Documentation/database-schema.md`
- **CLAUDE.md:** Project conventions and recent changes

---

## Change Log

| Date | Change |
|------|--------|
| December 27, 2025 | Initial documentation of failed approaches |

---

---

## FINAL SOLUTION: Edge Function + Correct n8n Configuration

**Status:** WORKING as of December 27, 2025

### Architecture

```
n8n Workflow (Human Approved Processor V1.0)
    ↓
Build Monday Request (Code Node)
    ↓
Create Monday Subitem (HTTP Request Node)
    ↓
Supabase Edge Function: create-monday-subitem
    ↓
Monday.com GraphQL API
    ↓
Returns subitem_id to n8n
    ↓
Update Monday IDs (Supabase Node)
```

### Edge Function

**Location:** `supabase/functions/create-monday-subitem/index.ts`

**Purpose:** Receives simple JSON from n8n, handles all GraphQL escaping, calls Monday.com API

**Input:**
```json
{
  "parent_item_id": "10858233234",
  "item_name": "SUPERNEWS & CARDS",
  "concept": "Supplies & Materials - COS",
  "date": "2025-12-04",
  "amount": 6.68
}
```

**Output:**
```json
{
  "success": true,
  "subitem_id": "10859114474",
  "subitem_name": "SUPERNEWS & CARDS",
  "parent_item_id": "10858233234",
  "duration_ms": 892
}
```

### n8n Configuration (CRITICAL DETAILS)

#### Build Monday Request (Code Node)

```javascript
const expense = $input.first().json;

return [{
  json: {
    parent_item_id: String(expense.monday_revenue_item_id),
    item_name: expense.merchant_name || 'Expense',
    concept: expense.category_name || '',
    date: expense.date || null,
    amount: expense.amount || 0
  }
}];
```

#### Create Monday Subitem (HTTP Request Node)

**CRITICAL SETTINGS:**

| Setting | Value | NOTES |
|---------|-------|-------|
| **Method** | `POST` | **MUST BE POST** - GET is default and doesn't send body! |
| **URL** | `https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/create-monday-subitem` | |
| **Send Headers** | ON | |
| **Send Body** | ON | |
| **Body Content Type** | JSON | |
| **Specify Body** | Using JSON | |
| **JSON Body** | `={{ JSON.stringify($json) }}` | **MUST use JSON.stringify()** |

**Headers:**

| Header | Value | Purpose |
|--------|-------|---------|
| `Authorization` | `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Service Role Key (legacy format) |
| `apikey` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` | Anon Key (legacy format) |
| `Content-Type` | `application/json` | Required |
| `x-api-key` | `a75eee4f7c0b40f6da958eacced7e466a2043359df065a092e1ebf1e2bc42db7` | Custom secret for Edge Function auth |

### Gotchas That Were Solved

1. **HTTP Method defaulted to GET** - No body sent with GET requests!
2. **JSON Body expression wrong** - `=={{ $json }}` doesn't work, must use `={{ JSON.stringify($json) }}`
3. **Wrong Supabase keys** - New format keys (`sb_publishable_...`) don't work for JWT verification, must use legacy JWT keys (`eyJhbG...`)

### Verification

**Curl test (confirmed working):**
```bash
curl -X POST "https://fzwozzqwyzztadxgjryl.supabase.co/functions/v1/create-monday-subitem" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "apikey: ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "x-api-key: CUSTOM_SECRET" \
  -d '{"parent_item_id":"10858233234","item_name":"Test Item","concept":"Test","date":"2025-12-27","amount":10.00}'
```

**Result:** Subitem ID `10859114474` created successfully

### Related Documentation

- `N8N_HTTP_REQUEST_GOTCHAS.md` - General n8n HTTP Request lessons
- `CLAUDE.md` - Project conventions with this integration documented
- `supabase/functions/create-monday-subitem/index.ts` - Edge Function source

---

## Change Log

| Date | Change |
|------|--------|
| December 27, 2025 | Initial documentation of failed approaches |
| December 27, 2025 | **SOLVED** - Added final working solution with Edge Function |

---

*End of N8N_MONDAY_SUBITEM_FAILED_APPROACHES.md*
