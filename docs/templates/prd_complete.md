# PRD: [Feature Name]

**Template:** PRD_COMPLETE  
**Complexity Score:** [X] points  
**Sprint:** [Sprint Number]  
**Created:** [Date]  
**Status:** Draft

---

## 1. Overview

### Business Goal
[What business problem does this solve?]

### User Story
As a [user type], I want to [action] so that [benefit].

### Success Metrics
- [Metric 1]: [Target]
- [Metric 2]: [Target]

---

## 2. Database Requirements

### New Tables

#### Table: [table_name]

**Purpose:** [What this table stores and why]

**Fields:**
- `id` - UUID, Primary Key, Auto-generated
- `user_id` - UUID, Foreign Key to `auth.users(id)`, Cascade Delete on user deletion
- `[field_name]` - [TYPE], [Required/Optional], [Additional constraints/description]
- `created_at` - Timestamp with timezone, Auto-generated on creation
- `updated_at` - Timestamp with timezone, Auto-updated on modification

**Indexes:**
- Index on `[field_name]` for [reason - e.g., fast lookups, sorting]
- Composite index on `([field1], [field2])` for [reason]

**Security (RLS):**
- [Description of access control policy]
- Example: "Users can only access their own records" → Policy: `auth.uid() = user_id`

**Constraints:**
- [Any unique constraints, check constraints, or business rules]
- Example: "Email must be unique per user"

### Modified Tables

#### Table: [existing_table_name]
**Changes:**
- Add field: `[field_name]` - [TYPE], [Required/Optional], [Description]
- Modify field: `[field_name]` - Change from [old_type] to [new_type], [Reason]

### Existing Tables Used

#### Table: [existing_table_name]
**Usage:** [How this feature will use this existing table]
**Fields accessed:** `[field1]`, `[field2]`, `[field3]`

---

## 3. API Contract

### Server Actions

#### createAction
**File:** `src/lib/actions/[entity].ts`

**Input Schema (Zod):**
```typescript
const CreateSchema = z.object({
  field1: z.string().min(1, 'Field 1 is required'),
  field2: z.string().email('Invalid email'),
  field3: z.number().optional(),
});
```

**Output:**
```typescript
interface ActionResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
```

**Business Logic:**
1. Validate input with Zod
2. Check authentication
3. [Business rule 1]
4. [Business rule 2]
5. Insert to database
6. Revalidate path
7. Return response

#### readAction, updateAction, deleteAction
[Similar structure for other CRUD operations]

---

## 4. External API Integration (if applicable)

### [API Name]

**Purpose:** [What this API does]

**Authentication:** [API Key / OAuth / JWT]

**Endpoints Used:**
- `POST /endpoint` - [Purpose]
- `GET /endpoint` - [Purpose]

**Implementation Location:** `src/lib/integrations/[api-name]/`

**Environment Variables:**
```
[API_NAME]_API_KEY=
[API_NAME]_BASE_URL=
```

---

## 5. Componentes de UI

Todos os componentes seguem o contrato do design system em [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md): wrappers finos sobre Radix Primitives, estilizados com tokens semânticos, variantes via `cva`, ícones Lucide. **Não redeclare regras neste PRD** — apenas referencie os componentes de `src/components/ui/` usados e os tokens semânticos esperados.

### Component Tree

```
Page: /[route]
├── [PageComponent]
│   ├── [ChildComponent1]
│   │   ├── Button (from src/components/ui/button — DS, cva variants)
│   │   └── Input (from src/components/ui/input — DS, semantic field tokens)
│   └── [ChildComponent2]
```

### [ComponentName]
**File:** `src/components/[path]/[ComponentName].tsx`

**Props:**
```typescript
interface Props {
  prop1: string;
  prop2?: number;
  onAction: () => void;
}
```

**Design system components used:**
- `Button` from `src/components/ui/button` (variant: `primary`, size: `lg`)
- `Input` from `src/components/ui/input` (type: `email`)
- `Card` from `src/components/ui/card` (with `CardHeader`, `CardTitle`, `CardContent`)

**Semantic tokens used:**
- Background: `bg-surface-raised` (card surface)
- Text: `text-text-primary` (heading), `text-text-secondary` (description)
- Border: `border-default`
- Action: `bg-action-primary`, `text-action-primary-fg`
- Feedback (if alert/toast): `bg-feedback-*-bg`, `text-feedback-*-fg`

**State:**
- [state1]: [purpose]
- [state2]: [purpose]

**Behavior:**
- On mount: [action]
- On submit: [action]
- On error: [action]

---

## 6. Edge Cases (CRITICAL)

### Empty States
- [ ] **No data exists:** Show empty state with "Create first [entity]" CTA
- [ ] **Search returns no results:** Show "No results found" message

### Validation Errors
- [ ] **Invalid email:** Show "Invalid email format" error
- [ ] **Required field empty:** Show "[Field] is required" error
- [ ] **Duplicate entry:** Show "[Entity] already exists" error

### Network Errors
- [ ] **API timeout:** Show "Request timed out, please try again" error
- [ ] **Network offline:** Show "No internet connection" error
- [ ] **Server error (500):** Show "Something went wrong, please try again" error

### Authentication Errors
- [ ] **User not logged in:** Redirect to /login
- [ ] **Session expired:** Show "Session expired, please login again"
- [ ] **Unauthorized access:** Show "You don't have permission" error

### Concurrent Operations
- [ ] **Simultaneous edits:** Last write wins (document this behavior)
- [ ] **Delete while editing:** Show "This item no longer exists" error

### Data Limits
- [ ] **Maximum entries reached:** Show "Maximum limit reached" error
- [ ] **File too large:** Show "File must be less than [X]MB" error

---

## 7. Acceptance Criteria (BINARY)

### Database
- [ ] Migration runs successfully without errors
- [ ] Migration is idempotent (can run multiple times)
- [ ] RLS policies prevent unauthorized access
- [ ] All indexes are created

### Backend
- [ ] All Server Actions validate input with Zod
- [ ] All Server Actions check authentication
- [ ] All Server Actions return ActionResponse<T>
- [ ] All errors are logged to console
- [ ] All errors show user-friendly messages
- [ ] revalidatePath() called after mutations

### Frontend (design system compliance)
- [ ] **O código passa em todas as checagens do [`agents/quality/guardian.md`](../../agents/quality/guardian.md) § 1a (regras automáticas) e § 1b (correção semântica).** A fonte normativa vive em [`design_system/enforcement/rules.md`](../../design_system/enforcement/rules.md) e [`design_system/components/CONTRACT.md`](../../design_system/components/CONTRACT.md). **Não duplique a lista das 8 regras aqui** — o Guardian rejeita o PR se qualquer regra falhar. Este item é o único gate frontend neste PRD.
- [ ] Componente verificado com `data-theme="dark"` togglado no `<html>`.
- [ ] Todos os formulários têm estado de loading.
- [ ] Todos os formulários têm estado de erro.
- [ ] Todos os formulários têm feedback de sucesso.

### Testing (on-demand only)
> QA is an on-demand agent. These criteria only apply when the user explicitly requests QA for this sprint. Omit this section from the acceptance gate otherwise.
- [ ] Unit tests for business logic (80% coverage)
- [ ] Integration tests for Server Actions (100% coverage)
- [ ] E2E test for happy path
- [ ] E2E test for validation errors
- [ ] E2E test for empty state

---

## 8. Implementation Plan

### Phase 1: Database (DB Admin)
1. Create migration file
2. Define table schema
3. Add indexes
4. Enable RLS
5. Create policies
6. Test migration

**Estimated Time:** 5 minutes

### Phase 2: Backend (Backend Dev)
1. Create Server Actions file
2. Define Zod schemas
3. Implement CRUD operations
4. Test actions

**Estimated Time:** 10 minutes

### Phase 3: Frontend (Frontend Dev)
1. Create components
2. Implement forms
3. Add loading states
4. Add error handling
5. Test UI

**Estimated Time:** 10 minutes

### Phase 4: Review (Guardian)
1. Validate design system compliance
2. Validate TypeScript quality
3. Validate security
4. Approve or reject

**Estimated Time:** 2 minutes

### Phase 5: Testing (QA Engineer — ON-DEMAND ONLY)
> Skip this phase unless the user explicitly activates the QA agent for this sprint.
1. Write unit tests
2. Write integration tests
3. Write E2E tests
4. Test edge cases

**Estimated Time:** 5 minutes (when requested)

**Total Estimated Time:** 27 minutes (without on-demand QA) / 32 minutes (with QA)

---

## 9. Risks & Mitigations

### Risk 1: [Risk description]
**Impact:** High/Medium/Low  
**Probability:** High/Medium/Low  
**Mitigation:** [How to mitigate]

### Risk 2: [Risk description]
**Impact:** High/Medium/Low  
**Probability:** High/Medium/Low  
**Mitigation:** [How to mitigate]

---

## 10. Dependencies

### Internal
- [ ] [Feature/Component] must be completed first
- [ ] [Table] must exist in database

### External
- [ ] [API] account setup required
- [ ] [Service] integration needed

---

## 11. Rollback Plan

If issues are found after deployment:

1. **Immediate:** Revert last commit
2. **Database:** Run rollback migration (if needed)
3. **Cache:** Clear revalidation cache
4. **Monitoring:** Check error logs

**Rollback Command:**
```bash
git revert [commit-hash]
supabase migration down (if needed)
```

---

## Approval

**Created by:** [Spec Writer]  
**Reviewed by:** [Sanity Checker]  
**Approved by:** [User]  
**Date:** [Date]
