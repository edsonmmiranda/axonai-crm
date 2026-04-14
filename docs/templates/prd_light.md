# PRD: [Feature Name]

**Template:** PRD_LIGHT  
**Complexity Score:** [X] points  
**Sprint:** [Sprint Number]  
**Created:** [Date]  
**Status:** Draft

---

## 1. Overview

**What:** [Brief description of the change]

**Why:** [Business justification]

**Impact:** [Who/what is affected]

---

## 2. Changes

### Database
- **Table:** `[table_name]`
- **Change:** [Add/Modify/Remove] field `[field_name]`
- **Type:** [Data type]
- **Constraints:** [Required/Optional, default value, etc.]

### Code (if applicable)
- **File:** `[file_path]`
- **Change:** [Description]

### UI (if applicable)
- **Component:** `[component_name]`
- **Change:** [Description]

---

## 3. Acceptance Criteria

- [ ] Change implemented correctly
- [ ] No errors in console/logs
- [ ] Existing functionality not broken
- [ ] [Specific criterion for this feature]

---

## 4. Rollback

**If issues found:**
1. Revert commit: `git revert [commit-hash]`
2. [Database rollback if needed]: `ALTER TABLE [table] DROP COLUMN [field]`
3. Clear cache if needed

**Estimated rollback time:** 2 minutes
