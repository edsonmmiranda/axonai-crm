# API Research Report: [API Name]

**API:** [Name]  
**Version:** [Version]  
**Documentation:** [URL]  
**Researched:** [Date]

---

## 1. API Overview

**Purpose:** [What this API does]  
**Provider:** [Company]  
**Pricing:** [Free tier / Paid / Usage-based]

---

## 2. Authentication Strategy

**Method:** [API Key / OAuth 2.0 / JWT / Basic Auth]

**Credentials Required:**
- `[API_NAME]_API_KEY` - [Description]
- `[API_NAME]_BASE_URL` - [Default value]

**Security Level:** [High / Medium / Low]

---

## 3. Endpoints Required

### [Endpoint Name]
- **Method:** POST
- **Path:** `/api/v1/endpoint`
- **Purpose:** [What it does]
- **Request:**
  ```json
  {
    "field1": "type (required)",
    "field2": "type (optional)"
  }
  ```
- **Response:**
  ```json
  {
    "id": "string",
    "status": "string"
  }
  ```

[Repeat for each endpoint]

---

## 4. Rate Limits & Quotas

**Rate Limits:**
- [X] requests per [minute/hour]

**Retry Strategy:**
- Exponential backoff: [Yes/No]
- Max retries: [Number]

---

## 5. Error Handling

**Common Errors:**
- `400`: [How to handle]
- `401`: [How to handle]
- `429`: [How to handle]
- `500`: [How to handle]

---

## 6. Security Considerations

**Risks:**
- [List identified risks]

**Mitigations:**
- [List mitigations]

---

## 7. Recommended Approach

**Implementation Strategy:**
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Estimated Complexity:** [Low / Medium / High]  
**Estimated Time:** [X] minutes

---

## Approval

**Researched by:** API Integrator  
**Status:** Awaiting Approval

**User Decision:**
- [ ] Approved - Proceed with implementation
- [ ] Rejected - Revise research
- [ ] Alternative approach: [Details]
