# Design Specification: Task Management Platform

## Screen Layout
The layout of the Task Management Platform is organized into several main sections, each serving a distinct purpose. The components are structured hierarchically to ensure a smooth user experience.

### Overall Layout
- **Top Navigation**: Contains the logo, workspace switcher, global search, notifications icon, and user menu.
- **Left Sidebar**: Navigation links to different sections of the application (Dashboard, Projects, Settings).
- **Main Content Area**: Dynamic content based on the selected section (Dashboard overview, Projects list, Task details).
- **Footer**: Static information and links (not applicable for all pages).

### Component Hierarchy
- **App**
  - **Header**
    - **Logo**
    - **Workspace Switcher**
    - **Global Search**
    - **Notifications Icon**
    - **User Menu**
  - **Sidebar**
    - **Navigation Links**
  - **Main Content**
    - **Dynamic Component (Dashboard, Projects, etc.)**
  - **Footer**

## Components
### Button
- **Props**: `label`, `onClick`, `type`, `disabled`
- **Behavior**: Triggers an action when clicked, could lead to navigation or state change.
- **States**: idle, hover, active, disabled, loading
- **Responsive**: Adjusts size based on viewport (e.g., smaller on mobile).

### Input Field
- **Props**: `value`, `onChange`, `placeholder`, `type`
- **Behavior**: Accepts user input; validation feedback shown inline.
- **States**: idle, focused, error
- **Responsive**: Full-width on mobile.

### Modal
- **Props**: `isOpen`, `onClose`, `title`, `children`
- **Behavior**: Displays content in an overlay; can be closed.
- **States**: open, closed
- **Responsive**: Centered and scales with viewport.

### Task List / Board
- **Props**: `tasks`, `onTaskClick`, `onTaskDrag`
- **Behavior**: Displays a list or board of tasks; supports drag-and-drop.
- **States**: loading, empty, populated
- **Responsive**: Stacks columns vertically on smaller screens.

### Dashboard Summary Card
- **Props**: `title`, `count`, `onClick`
- **Behavior**: Clickable card that navigates to filtered task view.
- **States**: idle, hover
- **Responsive**: Adjusts grid layout based on screen size.

### Task Detail
- **Props**: `task`, `onSave`, `onDelete`
- **Behavior**: Shows detailed information and allows for editing.
- **States**: loading, error, success
- **Responsive**: Stacks elements vertically on mobile.

## Design Tokens
| Token         | Value       | Usage                          |
|---------------|-------------|--------------------------------|
| Background    | #ffffff     | Primary background color       |
| Text          | #18181b     | Primary text color             |
| Accent        | #2563eb     | Highlight and button colors    |
| Border        | #e4e4e7     | Divider and border colors      |
| Input Border  | #d1d5db     | Input field borders            |
| Success Color | #22c55e     | Success messages and indicators |
| Error Color   | #ef4444     | Error messages and indicators   |
| Spacer        | 1rem        | Standard spacing unit          |

## Interaction Flow
1. **User clicks** "Start Free" → **System navigates** to the Sign Up page.
2. **User fills out** the Sign Up form → **System validates** and creates an account.
3. **User clicks** on a project in the Projects List → **System loads** Project Detail or Board.
4. **User drags** a task to a different status column → **System updates** task status.

## Accessibility
- **ARIA Roles and Labels**:
  - Use `role="button"` for all buttons.
  - Use `aria-label` to describe buttons and inputs accurately.
- **Keyboard Navigation**:
  - Ensure all interactive elements are reachable via Tab key.
  - Provide keyboard shortcuts for common actions (e.g., Create Task).
- **Screen Reader Considerations**:
  - Use meaningful labels for inputs and buttons, ensuring they convey the action or purpose.
  - Live regions for dynamic updates (e.g., task status changes) should be announced.

## Pencil Integration Notes
- Create .pen files for each screen as outlined in the PRD.
- Use components from the design system to maintain consistency.
- Ensure all interactive elements are clearly defined for user flows.

This design specification encapsulates the layout, components, interaction flows, design tokens, and accessibility guidelines for the Task Management Platform, ensuring a cohesive user experience across the application.