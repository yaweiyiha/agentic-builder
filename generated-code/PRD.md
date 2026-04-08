# PRD: Pomodoro Productivity Tracker

## 1. Executive Summary
The Pomodoro Productivity Tracker is a full-stack web application designed to help users manage their time effectively using the Pomodoro Technique. It provides a customizable timer, tracks completed work and break sessions, and offers insightful statistics on productivity patterns, enabling users to enhance focus and understand their work habits over time.

## 2. Problem & Solution
| Pain Point | Solution |
|-----------|----------|
| Difficulty maintaining focus during work sessions. | A clear, customizable Pomodoro timer with visual and audio cues to structure work and break intervals. |
| Lack of insight into actual work/break distribution and productivity trends. | A backend system to log all completed sessions and a dashboard to visualize daily, weekly, and monthly statistics. |
| Forgetting to take regular breaks, leading to burnout. | Automated short and long break timers with notifications to encourage regular rest periods. |
| Generic timer settings don't fit individual work styles. | User-configurable settings for work, short break, and long break durations. |

## 3. Goals & Non-Goals
### Goals (v1.0)
*   Enable users to start, pause, reset, and complete Pomodoro work and break sessions.
*   Allow users to customize work, short break, and long break durations.
*   Store completed Pomodoro sessions (work and break) for authenticated users.
*   Display basic productivity statistics (total sessions, total time, daily/weekly trends) to authenticated users.
*   Provide a clean, intuitive, and responsive user interface across common devices.
*   Implement secure user authentication and authorization.

### Non-Goals
*   Integration with external calendars or task management tools.
*   Team collaboration features or shared timers.
*   Advanced analytics like task-specific tracking or goal setting.
*   Desktop or mobile native applications (web-only for v1.0).
*   Offline mode functionality.
*   Complex sound customization beyond a single notification sound.

## 4. Feature Requirements

### Authentication Module
-   **FR-AU01**: User Registration (P0)
-   **FR-AU02**: User Login (P0)
-   **FR-AU03**: User Logout (P0)
-   **FR-AU04**: Password Hashing and Secure Storage (P0)

### Timer Module
-   **FR-TM01**: Start Pomodoro Work Session (P0)
-   **FR-TM02**: Pause/Resume Current Session (P0)
-   **FR-TM03**: Reset Current Session (P0)
-   **FR-TM04**: Skip Current Session (P1)
-   **FR-TM05**: Auto-start Next Session (e.g., break after work) (P1)
-   **FR-TM06**: Visual Timer Countdown Display (P0)
-   **FR-TM07**: Audio Notification on Session End (P0)
-   **FR-TM08**: Save Completed Session Data to Backend (P0)

### Settings Module
-   **FR-ST01**: Configure Work Session Duration (P0)
-   **FR-ST02**: Configure Short Break Duration (P0)
-   **FR-ST03**: Configure Long Break Duration (P0)
-   **FR-ST04**: Configure Number of Short Breaks before Long Break (P1)
-   **FR-ST05**: Save User Settings to Backend (P0)
-   **FR-ST06**: Load User Settings on Login (P0)

### Statistics Module
-   **FR-SM01**: Display Total Completed Work Sessions (P0)
-   **FR-SM02**: Display Total Completed Break Sessions (P0)
-   **FR-SM03**: Display Total Work Time (P0)
-   **FR-SM04**: Display Total Break Time (P0)
-   **FR-SM05**: Display Daily Productivity Graph (e.g., sessions per day) (P1)
-   **FR-SM06**: Display Weekly Productivity Graph (P1)
-   **FR-SM07**: Display Monthly Productivity Graph (P1)
-   **FR-SM08**: Filter Statistics by Date Range (P2)

## 5. Pages & Screens

### 5.1 Login Page
-   **URL / Route**: `/login`
-   **Access**: Public
-   **Purpose**: Allows existing users to sign in to their account.
-   **Layout**: Centered form within a clean, minimalist layout.
-   **Key Elements**:
    -   Header: Application logo/name.
    -   Email Input Field: Text input for user's email, default empty.
    -   Password Input Field: Password input for user's password, default empty.
    -   "Forgot Password?" Link: Navigates to password reset (out of scope for v1.0, but placeholder).
    -   "Login" Button: Primary action.
    -   "Don't have an account? Register" Link: Navigates to registration page.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Type in Email/Password | Input value updates | Input field reflects text |
    | Click "Login" | Validate inputs, POST to `/api/login` | Success: Redirect to `/timer`; Error: Inline message "Invalid credentials" |
    | Click "Register" link | Navigate to `/register` | Page loads Register Page |
-   **States**:
    -   **Default**: Empty input fields, "Login" button enabled.
    -   **Loading**: "Login" button disabled, spinner on button.
    -   **Error**: Inline error messages below input fields, general error toast.
-   **Layout regions**:
    1.  Header (Application Logo/Name)
    2.  Main Content (Login Form)
    3.  Footer (Register Link)
-   **On-screen inventory**:
    -   `<h1>` Application Title
    -   `<label>` Email
    -   `<input type="email">` Email input
    -   `<label>` Password
    -   `<input type="password">` Password input
    -   `<button>` Login
    -   `<a>` Don't have an account? Register

### 5.2 Register Page
-   **URL / Route**: `/register`
-   **Access**: Public
-   **Purpose**: Allows new users to create an account.
-   **Layout**: Similar to Login, centered form.
-   **Key Elements**:
    -   Header: Application logo/name.
    -   Email Input Field: Text input for user's email, default empty.
    -   Password Input Field: Password input for user's password, default empty.
    -   Confirm Password Input Field: Password input to confirm password.
    -   "Register" Button: Primary action.
    -   "Already have an account? Login" Link: Navigates to login page.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Type in Email/Password | Input value updates | Input field reflects text |
    | Click "Register" | Validate inputs (email format, password match, strength), POST to `/api/register` | Success: Redirect to `/timer` (logged in); Error: Inline message (e.g., "Email already exists", "Passwords don't match") |
    | Click "Login" link | Navigate to `/login` | Page loads Login Page |
-   **States**:
    -   **Default**: Empty input fields, "Register" button enabled.
    -   **Loading**: "Register" button disabled, spinner on button.
    -   **Error**: Inline error messages below input fields, general error toast.
-   **Layout regions**:
    1.  Header (Application Logo/Name)
    2.  Main Content (Registration Form)
    3.  Footer (Login Link)
-   **On-screen inventory**:
    -   `<h1>` Application Title
    -   `<label>` Email
    -   `<input type="email">` Email input
    -   `<label>` Password
    -   `<input type="password">` Password input
    -   `<label>` Confirm Password
    -   `<input type="password">` Confirm Password input
    -   `<button>` Register
    -   `<a>` Already have an account? Login

### 5.3 Pomodoro Timer Page
-   **URL / Route**: `/timer`
-   **Access**: Authenticated
-   **Purpose**: Main interface for starting, managing, and viewing the Pomodoro timer.
-   **Layout**: Header (Navigation), Main Content (Timer display, controls), Footer (optional, e.g., session count).
-   **Key Elements**:
    -   Header:
        -   App Logo/Name
        -   Navigation Links: "Timer", "Statistics", "Settings", "Logout"
    -   Timer Display: Large, prominent countdown display (MM:SS format), showing current session type (Work/Short Break/Long Break).
    -   Session Type Selector: Buttons/tabs to manually switch between Work, Short Break, Long Break (optional, primarily for manual override/start).
    -   Control Buttons: "Start", "Pause", "Resume", "Reset", "Skip".
    -   Current Cycle Indicator: Small dots/icons showing current Pomodoro cycle (e.g., 3 work sessions, 1 long break).
    -   Notification Sound: Plays when a session ends.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Click "Start" | Start countdown for current session type | Timer starts, "Start" becomes "Pause", session type displayed |
    | Click "Pause" | Halt countdown | Timer pauses, "Pause" becomes "Resume" |
    | Click "Resume" | Continue countdown | Timer resumes, "Resume" becomes "Pause" |
    | Click "Reset" | Stop timer, reset to initial duration | Timer resets, "Pause/Resume" becomes "Start", session data cleared for unsaved session |
    | Click "Skip" | End current session immediately, move to next | Timer resets, moves to next session type (e.g., work -> short break), current session marked as skipped (if applicable) |
    | Timer reaches 00:00 | Play notification sound, auto-start next session (if enabled), save completed session data | Timer resets, next session type starts, toast notification "Session Complete!" |
    | Click "Statistics" link | Navigate to `/statistics` | Page loads Statistics Dashboard |
    | Click "Settings" link | Navigate to `/settings` | Page loads Settings Page |
    | Click "Logout" link | POST to `/api/logout` | User logged out, redirect to `/login` |
-   **States**:
    -   **Default**: Timer displays default work duration, "Start" button enabled.
    -   **Running**: Timer counting down, "Pause" button enabled.
    -   **Paused**: Timer frozen, "Resume" button enabled.
    -   **Session End**: Timer at 00:00, notification plays, transitions to next session.
-   **Layout regions**:
    1.  Header (Navigation Bar)
    2.  Main Content (Timer Display, Control Buttons, Cycle Indicator)
-   **On-screen inventory**:
    -   `<h1>` Application Title
    -   `<a>` Timer Link
    -   `<a>` Statistics Link
    -   `<a>` Settings Link
    -   `<a>` Logout Link
    -   `<h2>` Current Session Type (e.g., "Work Time")
    -   `<div>` Timer Countdown (e.g., "25:00")
    -   `<button>` Start/Pause/Resume
    -   `<button>` Reset
    -   `<button>` Skip
    -   `<div>` Cycle Indicator (e.g., 4 small circles)

### 5.4 Statistics Dashboard Page
-   **URL / Route**: `/statistics`
-   **Access**: Authenticated
-   **Purpose**: Displays aggregated productivity data and trends.
-   **Layout**: Header (Navigation), Main Content (Summary cards, charts), Footer (optional).
-   **Key Elements**:
    -   Header: Navigation Links.
    -   Summary Cards:
        -   Total Work Sessions: Number display.
        -   Total Break Sessions: Number display.
        -   Total Work Time: Duration display (HH:MM).
        -   Total Break Time: Duration display (HH:MM).
    -   Date Range Selector: Dropdown or date pickers for "Today", "Last 7 Days", "Last 30 Days", "Custom".
    -   Productivity Chart: Bar chart or line graph showing completed sessions/time per day/week, based on selected range.
    -   (Optional) Session List: Recent completed sessions with type and duration.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Select date range from dropdown | Fetch data for new range from `/api/statistics?range=...` | Update summary cards and charts with new data, loading spinner during fetch |
    | Hover over chart bar/point | Display tooltip with specific data point details | Tooltip appears |
    | Click "Timer" link | Navigate to `/timer` | Page loads Pomodoro Timer Page |
-   **States**:
    -   **Default**: Displays statistics for "Last 7 Days".
    -   **Loading**: Charts and cards show skeleton loaders or spinners while data is fetched.
    -   **Empty**: "No data available for this period" message if no sessions.
    -   **Error**: "Failed to load statistics" message.
-   **Layout regions**:
    1.  Header (Navigation Bar)
    2.  Main Content (Summary Cards, Date Range Selector, Productivity Chart)
-   **On-screen inventory**:
    -   `<h1>` Application Title
    -   `<a>` Timer Link
    -   `<a>` Statistics Link
    -   `<a>` Settings Link
    -   `<a>` Logout Link
    -   `<h2>` Statistics Title
    -   `<div>` Summary Card (Total Work Sessions)
    -   `<div>` Summary Card (Total Break Sessions)
    -   `<div>` Summary Card (Total Work Time)
    -   `<div>` Summary Card (Total Break Time)
    -   `<select>` Date Range Selector
    -   `<div>` Chart Area (e.g., using a charting library)

### 5.5 Settings Page
-   **URL / Route**: `/settings`
-   **Access**: Authenticated
-   **Purpose**: Allows users to customize their Pomodoro durations and other preferences.
-   **Layout**: Header (Navigation), Main Content (Form for settings), Footer (optional).
-   **Key Elements**:
    -   Header: Navigation Links.
    -   Work Duration Input: Number input field (minutes), pre-filled with current setting.
    -   Short Break Duration Input: Number input field (minutes), pre-filled.
    -   Long Break Duration Input: Number input field (minutes), pre-filled.
    -   Long Break Interval Input: Number input field (work sessions), pre-filled.
    -   Notification Sound Toggle: Checkbox or switch to enable/disable sound.
    -   "Save Settings" Button: Primary action.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Change input value | Input field updates | Value reflects change |
    | Click "Save Settings" | Validate inputs, PUT to `/api/settings` | Success: "Settings saved!" toast, settings updated in backend; Error: Inline message (e.g., "Duration must be > 0"), error toast |
    | Click "Timer" link | Navigate to `/timer` | Page loads Pomodoro Timer Page |
-   **States**:
    -   **Default**: Input fields pre-filled with current user settings.
    -   **Loading**: "Save Settings" button disabled, spinner on button while saving.
    -   **Error**: Inline error messages, general error toast.
-   **Layout regions**:
    1.  Header (Navigation Bar)
    2.  Main Content (Settings Form)
-   **On-screen inventory**:
    -   `<h1>` Application Title
    -   `<a>` Timer Link
    -   `<a>` Statistics Link
    -   `<a>` Settings Link
    -   `<a>` Logout Link
    -   `<h2>` Settings Title
    -   `<label>` Work Duration
    -   `<input type="number">` Work Duration input
    -   `<label>` Short Break Duration
    -   `<input type="number">` Short Break Duration input
    -   `<label>` Long Break Duration
    -   `<input type="number">` Long Break Duration input
    -   `<label>` Long Break Interval
    -   `<input type="number">` Long Break Interval input
    -   `<button>` Save Settings

### 5.6 Error Page
-   **URL / Route**: `/error` (or any unhandled route)
-   **Access**: Public
-   **Purpose**: Informs the user that an unexpected error occurred or the page was not found.
-   **Layout**: Simple, centered message.
-   **Key Elements**:
    -   Error Message: "Something went wrong!" or "Page Not Found (404)".
    -   "Go to Home" Button/Link: Navigates to `/timer` (if authenticated) or `/login`.
-   **Interactions**:
    | Trigger | Action | Result / Feedback |
    |---------|--------|-------------------|
    | Click "Go to Home" | Navigate to `/timer` (or `/login`) | Page loads Timer/Login Page |
-   **States**:
    -   **Default**: Displays generic error message.
-   **Layout regions**:
    1.  Main Content (Error Message, Navigation Link)
-   **On-screen inventory**:
    -   `<h1>` Error Title
    -   `<p>` Error Description
    -   `<a>` Go to Home

## 5.3 Interaction overview (Mermaid diagram)

```mermaid
graph TD
    A[Start] --> B(Login Page);
    B -- Successful Login --> C(Pomodoro Timer Page);
    B -- "Don't have an account?" --> D(Register Page);
    D -- Successful Registration --> C;
    C -- Click "Statistics" --> E(Statistics Dashboard Page);
    C -- Click "Settings" --> F(Settings Page);
    E -- Click "Timer" --> C;
    E -- Click "Settings" --> F;
    F -- Click "Timer" --> C;
    F -- Click "Statistics" --> E;
    C -- Click "Logout" --> B;
    E -- Click "Logout" --> B;
    F -- Click "Logout" --> B;
    AnyPage -- Unhandled Error --> G(Error Page);
    G -- Click "Go to Home" --> B;
```

## 5.4 Interactive components index

| ID | Page | Component | Type | User interaction | Effect (feedback + outcome) |
|----|------|-----------|------|------------------|-----------------------------|
| 1 | Login | Email Input | `input[type="email"]` | Type text | Text appears in field |
| 2 | Login | Password Input | `input[type="password"]` | Type text | Obscured text appears in field |
| 3 | Login | Login Button | `button` | Click | Validates, POST to API; Success: redirect to Timer; Fail: inline error |
| 4 | Login | Register Link | `a` | Click | Navigates to Register Page |
| 5 | Register | Email Input | `input[type="email"]` | Type text | Text appears in field |
| 6 | Register | Password Input | `input[type="password"]` | Type text | Obscured text appears in field |
| 7 | Register | Confirm Password Input | `input[type="password"]` | Type text | Obscured text appears in field |
| 8 | Register | Register Button | `button` | Click | Validates, POST to API; Success: redirect to Timer; Fail: inline error |
| 9 | Register | Login Link | `a` | Click | Navigates to Login Page |
| 10 | Timer | Nav Link: Timer | `a` | Click | Stays on Timer Page (if already there); otherwise, navigates to Timer Page |
| 11 | Timer | Nav Link: Statistics | `a` | Click | Navigates to Statistics Dashboard Page |
| 12 | Timer | Nav Link: Settings | `a` | Click | Navigates to Settings Page |
| 13 | Timer | Nav Link: Logout | `a` | Click | POST to API; User logged out, redirect to Login Page |
| 14 | Timer | Start/Pause/Resume Button | `button` | Click "Start" | Timer starts countdown; button text changes to "Pause" |
| 15 | Timer | Start/Pause/Resume Button | `button` | Click "Pause" | Timer pauses; button text changes to "Resume" |
| 16 | Timer | Start/Pause/Resume Button | `button` | Click "Resume" | Timer resumes countdown; button text changes to "Pause" |
| 17 | Timer | Reset Button | `button` | Click | Timer resets to initial duration; button text becomes "Start" |
| 18 | Timer | Skip Button | `button` | Click | Current session ends, timer resets, next session type starts |
| 19 | Statistics | Nav Link: Timer | `a` | Click | Navigates to Pomodoro Timer Page |
| 20 | Statistics | Nav Link: Statistics | `a` | Click | Stays on Statistics Page |
| 21 | Statistics | Nav Link: Settings | `a` | Click | Navigates to Settings Page |
| 22 | Statistics | Nav Link: Logout | `a` | Click | POST to API; User logged out, redirect to Login Page |
| 23 | Statistics | Date Range Selector | `select` | Select option | Fetches and displays statistics for new date range |
| 24 | Settings | Nav Link: Timer | `a` | Click | Navigates to Pomodoro Timer Page |
| 25 | Settings | Nav Link: Statistics | `a` | Click | Navigates to Statistics Dashboard Page |
| 26 | Settings | Nav Link: Settings | `a` | Click | Stays on Settings Page |
| 27 | Settings | Nav Link: Logout | `a` | Click | POST to API; User logged out, redirect to Login Page |
| 28 | Settings | Work Duration Input | `input[type="number"]` | Change value | Input field reflects change; value prepared for save |
| 29 | Settings | Short Break Duration Input | `input[type="number"]` | Change value | Input field reflects change; value prepared for save |
| 30 | Settings | Long Break Duration Input | `input[type="number"]` | Change value | Input field reflects change; value prepared for save |
| 31 | Settings | Long Break Interval Input | `input[type="number"]` | Change value | Input field reflects change; value prepared for save |
| 32 | Settings | Save Settings Button | `button` | Click | Validates, PUT to API; Success: "Settings saved!" toast; Fail: inline error |
| 33 | Error | Go to Home Link/Button | `a` / `button` | Click | Navigates to `/timer` (if authenticated) or `/login` |

## 6. Key User Stories
| ID | As a... | I want to... | So that... |
|----|---------|-------------|-----------|
| US-01 | New User | register an account | I can save my productivity data. |
| US-02 | Existing User | log in to my account | I can access my personalized timer and statistics. |
| US-03 | User | start a Pomodoro work session | I can focus on my tasks for a set period. |
| US-04 | User | see a countdown timer | I know how much time is left in my current session. |
| US-05 | User | view my completed work and break statistics | I can understand my productivity patterns and habits. |
| US-06 | User | customize my work and break durations | the timer fits my personal workflow and preferences. |

## 7. Acceptance Criteria

| ID | Feature / Story Ref | Criterion | How to Verify |
|----|---------------------|-----------|---------------|
| AC-01 | FR-AU01, US-01 | User can successfully register with a unique email and valid password. | Manual: Attempt registration with valid/invalid inputs; check database for new user record. |
| AC-02 | FR-AU02, US-02 | User is redirected to the Pomodoro Timer Page upon successful login. | Manual: Log in with valid credentials; observe URL and page content. |
| AC-03 | FR-TM01, US-03 | Clicking "Start" initiates the countdown from the configured work duration. | Manual: Set work duration, click "Start", verify timer starts counting down. |
| AC-04 | FR-TM06, US-04 | The timer display updates every second in MM:SS format. | Manual: Observe timer during an active session for smooth, second-by-second updates. |
| AC-05 | FR-TM07 | An audible notification plays when any session (work or break) ends. | Manual: Let a session run to completion; verify sound plays. |
| AC-06 | FR-TM08 | A completed work session is recorded in the user's statistics. | Manual: Complete a work session, navigate to Statistics, verify session count increases. |
| AC-07 | FR-ST01, US-06 | User can change work duration in settings and it applies to new sessions. | Manual: Change work duration in Settings, save, go to Timer, reset timer, verify new duration. |
| AC-08 | FR-SM01, US-05 | The Statistics Dashboard accurately displays the total number of completed work sessions. | Manual: Complete several work sessions, check if the "Total Work Sessions" count matches. |
| AC-09 | FR-SM05 | The daily productivity graph visualizes completed sessions for the selected day. | Manual: Complete sessions on different days, select "Today" or "Last 7 Days", verify graph bars reflect session counts. |
| AC-10 | FR-AU03 | User can successfully log out and is redirected to the Login Page. | Manual: Click "Logout", verify user is on Login Page and cannot access authenticated routes directly. |
| AC-11 | FR-TM02 | Clicking "Pause" stops the timer, and "Resume" continues it from the paused time. | Manual: Start timer, click "Pause", observe timer stops; click "Resume", observe timer continues from paused time. |
| AC-12 | FR-TM03 | Clicking "Reset" returns the timer to its initial duration for the current session type. | Manual: Start timer, let it run for a bit, click "Reset", verify timer displays full duration. |

## 8. Technical Requirements

| Category | Requirement |
|----------|------------|
| **Performance** | Page load time for main views (Timer, Statistics) should be under 2 seconds on a broadband connection. |
| **Performance** | Timer countdown should update smoothly without noticeable lag or stutter. |
| **Security** | User passwords must be hashed and salted before storage (e.g., bcrypt). |
| **Security** | All API endpoints requiring authentication must enforce token-based authentication (e.g., JWT). |
| **Security** | All network communication (frontend to backend) must use HTTPS. |
| **Browser Support** | The application must be fully functional and responsive on the latest stable versions of Chrome, Firefox, Safari, and Edge. |
| **Scalability (Basic)** | The backend should be capable of handling up to 100 concurrent active users without significant performance degradation. |

## 9. Data Model Overview

### User
Represents a user account in the system.
-   `id`: Primary Key (UUID)
-   `email`: String (Unique, required)
-   `password_hash`: String (Required, securely hashed)
-   `created_at`: Timestamp
-   `updated_at`: Timestamp

### UserSettings
Stores customizable preferences for each user's Pomodoro timer.
-   `id`: Primary Key (UUID)
-   `user_id`: Foreign Key to User (Unique, required)
-   `work_duration_minutes`: Integer (Default: 25)
-   `short_break_duration_minutes`: Integer (Default: 5)
-   `long_break_duration_minutes`: Integer (Default: 15)
-   `long_break_interval`: Integer (Number of work sessions before a long break, Default: 4)
-   `notification_sound_enabled`: Boolean (Default: true)
-   `created_at`: Timestamp
-   `updated_at`: Timestamp

### PomodoroSession
Records each completed Pomodoro session (work or break).
-   `id`: Primary Key (UUID)
-   `user_id`: Foreign Key to User (Required)
-   `session_type`: Enum (e.g., 'work', 'short_break', 'long_break')
-   `duration_minutes`: Integer (Actual duration completed, in minutes)
-   `start_time`: Timestamp
-   `end_time`: Timestamp
-   `status`: Enum (e.g., 'completed', 'skipped', 'aborted' - 'completed' for v1.0)
-   `created_at`: Timestamp

**Relationships:**
-   `User` has one `UserSettings`.
-   `User` has many `PomodoroSession`s.
-   `UserSettings` belongs to one `User`.
-   `PomodoroSession` belongs to one `User`.