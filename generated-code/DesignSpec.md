Design Specification: AeroCommerce Admin & Vendor Portal
Screen Layout
The AeroCommerce Portal utilizes a responsive App Shell architecture, serving both Platform Admins (Admin Alice) and 3rd-Party Sellers (Vendor Vince) through role-based access control.

Component Hierarchy
[AppShell]
├── [SidebarNavigation] (Collapsible, role-contextual links)
│ ├── Dashboard
│ ├── Catalog (PIM)
│ ├── Orders (OMS)
│ ├── Customers & B2B
│ └── Vendors & Payouts (Admin only)
├── [TopHeader]
│ ├── [GlobalSearch] (AI-powered vector search input)
│ ├── [NotificationBell]
│ └── [UserMenu]
└── [MainContentArea]
├── [PageHeader] (Title, Breadcrumbs, Primary Actions)
├── [MetricsGrid] (GMV, Order Volume, etc.)
└── [DataViews] (DataTables, Forms, or Detail Views)
Components
SidebarNavigation
Props: userRole (admin | vendor), isCollapsed (boolean), activePath (string)
Behavior:
Expands/collapses via a toggle button.
Links animate in/out using Motion layout animations.
Renders specific links based on userRole (e.g., Vendors don't see the global "Vendors & Payouts" tab).
States:
idle: text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900
active: bg-blue-50 text-blue-600 border-r-4 border-blue-600
Responsive: Hidden on mobile (behind a hamburger menu triggering a slide-out drawer).
DataTable (Catalog / OMS)
Props: columns (array), data (array), selectable (boolean), onRowAction (function), pagination (object)
Behavior:
Supports column sorting and faceted filtering (Price, Category, Vendor).
Bulk actions bar slides up from the bottom when rows are selected (Motion y: 100 to y: 0).
States:
loading: Skeleton rows with pulse animation.
empty: Illustration with "No records found" and a primary "Create New" button.
Responsive: On < 768px, converts rows into stacked cards to prevent horizontal scrolling issues.
StatusBadge
Props: status (string), type (order | product | vendor)
Behavior: Static visual indicator.
States:
Product: Draft (zinc), Published (emerald), Scheduled (blue).
Order: Pending (amber), Paid (emerald), Shipped (blue), Refunded (red).
Responsive: Scales padding slightly down on mobile.
B2BPricingMatrix (Inside ProductForm)
Props: basePrice (number), tiers (array of objects), customerGroups (array)
Behavior:
Allows users to add volume-based rules (e.g., "Min Qty: 100 -> Price: $8.00").
Dynamic input rows that can be added/removed with Framer Motion AnimatePresence.
States:
error: Highlights overlapping quantity tiers with a red border and helper text.
Responsive: Stacks input fields vertically on mobile breakpoints.
Design Tokens
Token Value (Light Theme First) Usage
bg-primary #ffffff Main application background, card backgrounds
bg-secondary #f4f4f5 (zinc-100) Sidebar background, table headers, hover states
text-primary #18181b (zinc-900) Primary headings, standard body text
text-secondary #52525b (zinc-600) Subtitles, table data, helper text
accent-primary #2563eb (blue-600) Primary buttons, active nav states, focused inputs
accent-hover #1d4ed8 (blue-700) Primary button hover states
status-success #10b981 (emerald-500) "Published" / "Paid" badges, success toasts
status-warning #f59e0b (amber-500) "Pending" / "Draft" badges
status-danger #ef4444 (red-500) "Canceled" / "Refunded" badges, destructive actions
radius-base 0.5rem (rounded-lg) Cards, buttons, inputs
shadow-base 0 4px 6px -1px rgb(0 0 0 / 0.1) Floating menus, dropdowns, modals
Interaction Flow
Flow 1: Creating a Product with B2B Pricing
User clicks "Add Product" → System routes to /catalog/new.
User fills in General Info (Title, Description).
User navigates to "Pricing" tab.
User enters Base B2C Price.
User clicks "Add B2B Tier" → System smoothly expands a new row (Motion).
User enters "Min Qty: 50" and "Price: $15" → System validates inputs.
User clicks "Save" → System triggers createProduct GraphQL mutation.
System responds with success → Button shows loading spinner, then transitions to a success checkmark. Redirects to Catalog list with a success toast.
Flow 2: Processing a Vendor Order
Vendor navigates to Orders tab → Clicks on an order marked Paid.
System opens Order Detail Slide-over (Motion x: '100%' to 0).
Vendor clicks "Fulfill Order" → System opens a modal to input Carrier and Tracking Number.
Vendor submits → System updates state to Shipped and triggers order.shipped webhook.
UI optimistically updates the StatusBadge to Blue (Shipped).
Accessibility
ARIA Roles & Labels:
role="navigation" on Sidebar.
aria-label="Toggle Sidebar" on hamburger menu.
role="alert" on error boundaries and toast notifications.
Keyboard Navigation:
Full support for Tab navigation through DataTables and Forms.
Custom focus rings applied globally: focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2.
Screen Reader Considerations:
AI Search input announces "Search results updated" via aria-live="polite" when vector search returns new suggestions.
Status badges include visually hidden text (e.g., <span class="sr-only">Order Status: </span>Paid).
Pencil Integration Notes
When generating .pen files for this specification, follow these guidelines:

Grid Setup: Use a 1440px desktop canvas. Left sidebar width: 256px. Header height: 64px.
Catalog View Mockup:
Draw the SidebarNav with the "Catalog" item highlighted using the accent-primary color.
Place a PageHeader with an "Add Product" button (fill: #2563eb, text: #ffffff, rounded corners: 8px).
Draw a 5-column DataTable (Checkbox, Product Name, SKU, Price, Status).
Use status-success (emerald) and status-warning (amber) pills for the Status column.
B2B Pricing Form Mockup:
Draw a card layout with standard inputs (border: 1px solid #e4e4e7).
Show a nested gray box (bg-secondary) representing the B2B volume pricing rows to illustrate the visual hierarchy.
Scrollbars: Apply a custom light zinc scrollbar to the main content area (track: #f4f4f5, thumb: #d4d4d8).
