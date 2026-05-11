# Linear Issue Creator

Create a concise Linear issue from the user's business-language description.

The raw user input is in `$ARGUMENTS`.

## Workflow

1. Read the user input
2. Expand it into a short structured issue
3. Show the draft
4. Ask for confirmation
5. Create the issue in Linear only after approval

## Language

The issue title and body (Description / Current behavior / Expected behavior) must be written in **Russian**, regardless of the language of the user's input. Keep section headings (`## Description`, `## Current behavior`, `## Expected behavior`, `## Priority`) and the priority value (`low`/`mid`/`high`/`critical`) in English. (This is the one place we write Russian — UI copy elsewhere stays English.)

---

## Required fields

### Title
Short and clear summary.

Rules:
- max 70 characters
- no trailing period
- avoid technical implementation details

---

### Description
Brief explanation of the problem or request.

Rules:
- max 5 sentences
- concise and readable
- no enterprise-style specification language
- do not invent technical details

---

### Current behavior
Describe:
- what happens now
- or what limitation currently exists

Rules:
- max 3 bullet points
- omit if truly not applicable

---

### Expected behavior
Describe the desired outcome.

Rules:
- max 3 bullet points
- observable outcomes only
- avoid implementation details

---

### Priority

Allowed values:
- low
- mid
- high
- critical

Priority meaning:
- low → optional improvement
- mid → normal planned work
- high → important functionality or workflow blocker
- critical → production issue, severe business impact, or data loss risk

Rules:
- if priority is explicitly provided → use it
- otherwise ask the user before drafting

---

## Draft format

```md
# <Title>

## Description
<short description>

## Current behavior
- ...
- ...

## Expected behavior
- ...
- ...

## Priority
<low|mid|high|critical>
```

---

## Confirmation step

Before creating the issue:
- show the final markdown draft
- ask the user for confirmation

Allowed responses:
- create
- edit
- cancel

---

## Creation rules

- Create issues only after explicit approval
- Default Linear state: Backlog
- Do not include creation date in the issue body
- Do not invent missing product requirements
- Do not generate long specifications
- Do not split into multiple tasks unless explicitly requested