# Pencil Design Operations

Generated at 2026-04-01T13:26:30.997Z

## batch_design blocks

### Block 1
```
landing=I(document,{type:"frame",layout:"vertical",width:1440,height:1024,fill:"#0F172A",name:"Landing Page"})
landing_nav=I(landing,{type:"frame",layout:"horizontal",width:"fill_container",height:72,padding:[0,48],alignItems:"center",justifyContent:"space_between",fill:"#1E293B"})
landing_logo_container=I(landing_nav,{type:"frame",layout:"horizontal",gap:12,alignItems:"center"})
landing_logo_icon=I(landing_logo_container,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"timer",width:32,height:32,fill:"#6366F1"})
```

### Block 2
```
landing_logo_text=I(landing_logo_container,{type:"text",text:"PomoFocus",fontSize:24,fontWeight:"bold",fill:"#F1F5F9"})
landing_nav_links=I(landing_nav,{type:"frame",layout:"horizontal",gap:24,alignItems:"center"})
landing_login_link=I(landing_nav_links,{type:"text",text:"Log in",fontSize:16,fontWeight:"500",fill:"#94A3B8"})
landing_signup_btn=I(landing_nav_links,{type:"frame",layout:"horizontal",padding:[10,20],cornerRadius:8,fill:"#6366F1",alignItems:"center"})
```

### Block 3
```
landing_signup_text=I(landing_signup_btn,{type:"text",text:"Sign up",fontSize:16,fontWeight:"600",fill:"#FFFFFF"})
landing_hero=I(landing,{type:"frame",layout:"vertical",width:"fill_container",padding:[120,48,80,48],alignItems:"center",gap:32})
landing_hero_badge=I(landing_hero,{type:"frame",layout:"horizontal",padding:[6,16],cornerRadius:999,fill:"#1E293B",alignItems:"center"})
landing_hero_badge_text=I(landing_hero_badge,{type:"text",text:"v1.0 is now live \u2192",fontSize:14,fontWeight:"500",fill:"#6366F1"})
```

### Block 4
```
landing_hero_title=I(landing_hero,{type:"text",text:"Focus on what matters.",fontSize:64,fontWeight:"800",fill:"#F1F5F9",textAlign:"center"})
landing_hero_subtitle=I(landing_hero,{type:"text",text:"Overcome distractions, maintain sustained focus, and prevent burnout\nwith our customizable Pomodoro timer and task manager.",fontSize:20,fontWeight:"400",fill:"#94A3B8",textAlign:"center"})
landing_hero_cta=I(landing_hero,{type:"frame",layout:"horizontal",padding:[16,32],cornerRadius:12,fill:"#6366F1",alignItems:"center",gap:12})
landing_hero_cta_text=I(landing_hero_cta,{type:"text",text:"Start Focusing Now",fontSize:18,fontWeight:"600",fill:"#FFFFFF"})
```

### Block 5
```
landing_hero_cta_icon=I(landing_hero_cta,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"arrow-right",width:20,height:20,fill:"#FFFFFF"})
landing_features=I(landing,{type:"frame",layout:"horizontal",width:"fill_container",padding:[40,120],gap:32,justifyContent:"center"})
feature1=I(landing_features,{type:"frame",layout:"vertical",width:340,padding:[32,24],cornerRadius:16,fill:"#1E293B",gap:16})
f1_icon_bg=I(feature1,{type:"frame",layout:"vertical",width:48,height:48,cornerRadius:12,fill:"#334155",alignItems:"center",justifyContent:"center"})
```

### Block 6
```
f1_icon=I(f1_icon_bg,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"clock",width:24,height:24,fill:"#EF4444"})
f1_title=I(feature1,{type:"text",text:"Structured Sessions",fontSize:20,fontWeight:"600",fill:"#F1F5F9"})
f1_desc=I(feature1,{type:"text",text:"Customizable Pomodoro, short break, and long break timers to keep your mind fresh.",fontSize:16,fontWeight:"400",fill:"#94A3B8"})
feature2=I(landing_features,{type:"frame",layout:"vertical",width:340,padding:[32,24],cornerRadius:16,fill:"#1E293B",gap:16})
```

### Block 7
```
f2_icon_bg=I(feature2,{type:"frame",layout:"vertical",width:48,height:48,cornerRadius:12,fill:"#334155",alignItems:"center",justifyContent:"center"})
f2_icon=I(f2_icon_bg,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"check-square",width:24,height:24,fill:"#10B981"})
f2_title=I(feature2,{type:"text",text:"Task Management",fontSize:20,fontWeight:"600",fill:"#F1F5F9"})
f2_desc=I(feature2,{type:"text",text:"Integrated task list to estimate and allocate your focus sessions effectively.",fontSize:16,fontWeight:"400",fill:"#94A3B8"})
```

### Block 8
```
feature3=I(landing_features,{type:"frame",layout:"vertical",width:340,padding:[32,24],cornerRadius:16,fill:"#1E293B",gap:16})
f3_icon_bg=I(feature3,{type:"frame",layout:"vertical",width:48,height:48,cornerRadius:12,fill:"#334155",alignItems:"center",justifyContent:"center"})
f3_icon=I(f3_icon_bg,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"bar-chart-2",width:24,height:24,fill:"#3B82F6"})
f3_title=I(feature3,{type:"text",text:"Productivity Stats",fontSize:20,fontWeight:"600",fill:"#F1F5F9"})
```

### Block 9
```
f3_desc=I(feature3,{type:"text",text:"Visualize your daily and weekly completed sessions to build better habits.",fontSize:16,fontWeight:"400",fill:"#94A3B8"})
login_screen=I(document,{type:"frame",layout:"vertical",width:1440,height:900,fill:"#0F172A",name:"Login Page",alignItems:"center",justifyContent:"center"})
login_card=I(login_screen,{type:"frame",layout:"vertical",width:400,padding:[40,40],cornerRadius:16,fill:"#1E293B",gap:24,alignItems:"center"})
login_logo=I(login_card,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"timer",width:48,height:48,fill:"#6366F1"})
```

### Block 10
```
login_title=I(login_card,{type:"text",text:"Welcome back",fontSize:24,fontWeight:"bold",fill:"#F1F5F9"})
login_form=I(login_card,{type:"frame",layout:"vertical",width:"fill_container",gap:16})
login_email_group=I(login_form,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
login_email_label=I(login_email_group,{type:"text",text:"Email address",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
```

### Block 11
```
login_email_input=I(login_email_group,{type:"frame",layout:"horizontal",width:"fill_container",height:48,padding:[0,16],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
login_email_text=I(login_email_input,{type:"text",text:"you@example.com",fontSize:16,fill:"#64748B"})
login_pass_group=I(login_form,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
login_pass_header=I(login_pass_group,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"space_between",alignItems:"center"})
```

### Block 12
```
login_pass_label=I(login_pass_header,{type:"text",text:"Password",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
login_pass_forgot=I(login_pass_header,{type:"text",text:"Forgot Password?",fontSize:14,fontWeight:"500",fill:"#6366F1"})
login_pass_input=I(login_pass_group,{type:"frame",layout:"horizontal",width:"fill_container",height:48,padding:[0,16],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
login_pass_text=I(login_pass_input,{type:"text",text:"••••••••",fontSize:16,fill:"#F1F5F9"})
```

### Block 13
```
login_btn=I(login_form,{type:"frame",layout:"horizontal",width:"fill_container",height:48,cornerRadius:8,fill:"#6366F1",alignItems:"center",justifyContent:"center",marginTop:8})
login_btn_text=I(login_btn,{type:"text",text:"Log In",fontSize:16,fontWeight:"600",fill:"#FFFFFF"})
login_footer=I(login_card,{type:"frame",layout:"horizontal",gap:8,marginTop:8})
login_footer_text=I(login_footer,{type:"text",text:"Don't have an account?",fontSize:14,fill:"#94A3B8"})
```

### Block 14
```
login_footer_link=I(login_footer,{type:"text",text:"Sign up",fontSize:14,fontWeight:"500",fill:"#6366F1"})
signup_screen=I(document,{type:"frame",layout:"vertical",width:1440,height:900,fill:"#0F172A",name:"Signup Page",alignItems:"center",justifyContent:"center"})
signup_card=I(signup_screen,{type:"frame",layout:"vertical",width:400,padding:[40,40],cornerRadius:16,fill:"#1E293B",gap:24,alignItems:"center"})
signup_logo=I(signup_card,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"timer",width:48,height:48,fill:"#6366F1"})
```

### Block 15
```
signup_title=I(signup_card,{type:"text",text:"Create an account",fontSize:24,fontWeight:"bold",fill:"#F1F5F9"})
signup_form=I(signup_card,{type:"frame",layout:"vertical",width:"fill_container",gap:16})
signup_name_group=I(signup_form,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
signup_name_label=I(signup_name_group,{type:"text",text:"Full Name",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
```

### Block 16
```
signup_name_input=I(signup_name_group,{type:"frame",layout:"horizontal",width:"fill_container",height:48,padding:[0,16],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
signup_name_text=I(signup_name_input,{type:"text",text:"Jane Doe",fontSize:16,fill:"#64748B"})
signup_email_group=I(signup_form,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
signup_email_label=I(signup_email_group,{type:"text",text:"Email address",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
```

### Block 17
```
signup_email_input=I(signup_email_group,{type:"frame",layout:"horizontal",width:"fill_container",height:48,padding:[0,16],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
signup_email_text=I(signup_email_input,{type:"text",text:"jane@example.com",fontSize:16,fill:"#64748B"})
signup_pass_group=I(signup_form,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
signup_pass_label=I(signup_pass_group,{type:"text",text:"Password",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
```

### Block 18
```
signup_pass_input=I(signup_pass_group,{type:"frame",layout:"horizontal",width:"fill_container",height:48,padding:[0,16],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
signup_pass_text=I(signup_pass_input,{type:"text",text:"••••••••",fontSize:16,fill:"#64748B"})
signup_btn=I(signup_form,{type:"frame",layout:"horizontal",width:"fill_container",height:48,cornerRadius:8,fill:"#6366F1",alignItems:"center",justifyContent:"center",marginTop:8})
signup_btn_text=I(signup_btn,{type:"text",text:"Create Account",fontSize:16,fontWeight:"600",fill:"#FFFFFF"})
```

### Block 19
```
signup_footer=I(signup_card,{type:"frame",layout:"horizontal",gap:8,marginTop:8})
signup_footer_text=I(signup_footer,{type:"text",text:"Already have an account?",fontSize:14,fill:"#94A3B8"})
signup_footer_link=I(signup_footer,{type:"text",text:"Log in",fontSize:14,fontWeight:"500",fill:"#6366F1"})
app_screen=I(document,{type:"frame",layout:"vertical",width:1440,height:1024,fill:"#0F172A",name:"Main Dashboard"})
```

### Block 20
```
app_nav=I(app_screen,{type:"frame",layout:"horizontal",width:"fill_container",height:64,padding:[0,48],alignItems:"center",justifyContent:"space_between",fill:"#1E293B"})
app_logo_container=I(app_nav,{type:"frame",layout:"horizontal",gap:12,alignItems:"center"})
app_logo_icon=I(app_logo_container,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"timer",width:28,height:28,fill:"#6366F1"})
app_logo_text=I(app_logo_container,{type:"text",text:"PomoFocus",fontSize:20,fontWeight:"bold",fill:"#F1F5F9"})
```

### Block 21
```
app_nav_right=I(app_nav,{type:"frame",layout:"horizontal",gap:24,alignItems:"center"})
app_nav_stats=I(app_nav_right,{type:"frame",layout:"horizontal",gap:8,alignItems:"center"})
app_nav_stats_icon=I(app_nav_stats,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"bar-chart-2",width:20,height:20,fill:"#94A3B8"})
app_nav_stats_text=I(app_nav_stats,{type:"text",text:"Stats",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
```

### Block 22
```
app_nav_settings=I(app_nav_right,{type:"frame",layout:"horizontal",gap:8,alignItems:"center"})
app_nav_settings_icon=I(app_nav_settings,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"settings",width:20,height:20,fill:"#94A3B8"})
app_nav_settings_text=I(app_nav_settings,{type:"text",text:"Settings",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
app_nav_profile=I(app_nav_right,{type:"frame",layout:"horizontal",width:32,height:32,cornerRadius:16,fill:"#334155",alignItems:"center",justifyContent:"center"})
```

### Block 23
```
app_nav_profile_text=I(app_nav_profile,{type:"text",text:"J",fontSize:14,fontWeight:"bold",fill:"#F1F5F9"})
app_main=I(app_screen,{type:"frame",layout:"vertical",width:"fill_container",padding:[48,0],alignItems:"center"})
app_container=I(app_main,{type:"frame",layout:"vertical",width:600,gap:32})
timer_card=I(app_container,{type:"frame",layout:"vertical",width:"fill_container",padding:[40,40],cornerRadius:24,fill:"#1E293B",alignItems:"center",gap:32})
```

### Block 24
```
timer_modes=I(timer_card,{type:"frame",layout:"horizontal",padding:[6,6],cornerRadius:12,fill:"#0F172A",gap:4})
mode_focus=I(timer_modes,{type:"frame",layout:"horizontal",padding:[8,16],cornerRadius:8,fill:"#EF4444",alignItems:"center"})
mode_focus_text=I(mode_focus,{type:"text",text:"Pomodoro",fontSize:14,fontWeight:"600",fill:"#FFFFFF"})
mode_short=I(timer_modes,{type:"frame",layout:"horizontal",padding:[8,16],cornerRadius:8,alignItems:"center"})
```

### Block 25
```
mode_short_text=I(mode_short,{type:"text",text:"Short Break",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
mode_long=I(timer_modes,{type:"frame",layout:"horizontal",padding:[8,16],cornerRadius:8,alignItems:"center"})
mode_long_text=I(mode_long,{type:"text",text:"Long Break",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
timer_display=I(timer_card,{type:"text",text:"25:00",fontSize:120,fontWeight:"bold",fill:"#F1F5F9"})
```

### Block 26
```
timer_controls=I(timer_card,{type:"frame",layout:"horizontal",gap:16,alignItems:"center"})
timer_start_btn=I(timer_controls,{type:"frame",layout:"horizontal",width:200,height:64,cornerRadius:32,fill:"#EF4444",alignItems:"center",justifyContent:"center",shadow:"0 4px 14px 0 rgba(239, 68, 68, 0.39)"})
timer_start_text=I(timer_start_btn,{type:"text",text:"START",fontSize:24,fontWeight:"bold",fill:"#FFFFFF"})
timer_skip_btn=I(timer_controls,{type:"frame",layout:"vertical",width:64,height:64,cornerRadius:32,fill:"#334155",alignItems:"center",justifyContent:"center"})
```

### Block 27
```
timer_skip_icon=I(timer_skip_btn,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"skip-forward",width:24,height:24,fill:"#F1F5F9"})
tasks_section=I(app_container,{type:"frame",layout:"vertical",width:"fill_container",gap:16})
tasks_header=I(tasks_section,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"space_between",alignItems:"center"})
tasks_title=I(tasks_header,{type:"text",text:"Tasks",fontSize:20,fontWeight:"bold",fill:"#F1F5F9"})
```

### Block 28
```
tasks_options=I(tasks_header,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"more-vertical",width:20,height:20,fill:"#94A3B8"})
task_input_container=I(tasks_section,{type:"frame",layout:"horizontal",width:"fill_container",height:56,padding:[0,16],cornerRadius:12,fill:"#1E293B",alignItems:"center",gap:12,border:"1px solid #334155"})
task_input_icon=I(task_input_container,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"plus-circle",width:20,height:20,fill:"#94A3B8"})
task_input_text=I(task_input_container,{type:"text",text:"Add a task...",fontSize:16,fill:"#64748B",textGrowth:"fixed-width",width:460})
```

### Block 29
```
task_input_est=I(task_input_container,{type:"frame",layout:"horizontal",padding:[4,8],cornerRadius:6,fill:"#334155",alignItems:"center",gap:4})
task_input_est_val=I(task_input_est,{type:"text",text:"1",fontSize:14,fontWeight:"500",fill:"#F1F5F9"})
task_input_est_icon=I(task_input_est,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"chevron-up",width:14,height:14,fill:"#94A3B8"})
task_list=I(tasks_section,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
```

### Block 30
```
task_item_1=I(task_list,{type:"frame",layout:"horizontal",width:"fill_container",padding:[16,16],cornerRadius:12,fill:"#1E293B",alignItems:"center",gap:12,borderLeft:"4px solid #EF4444"})
t1_checkbox=I(task_item_1,{type:"frame",layout:"vertical",width:24,height:24,cornerRadius:6,border:"2px solid #64748B",alignItems:"center",justifyContent:"center"})
t1_title=I(task_item_1,{type:"text",text:"Finish Q3 Marketing Report",fontSize:16,fontWeight:"500",fill:"#F1F5F9",textGrowth:"fixed-width",width:420})
t1_pomos=I(task_item_1,{type:"frame",layout:"horizontal",alignItems:"center",gap:4})
```

### Block 31
```
t1_pomos_text=I(t1_pomos,{type:"text",text:"0 / 3",fontSize:14,fontWeight:"600",fill:"#94A3B8"})
t1_actions=I(task_item_1,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"more-vertical",width:16,height:16,fill:"#64748B"})
task_item_2=I(task_list,{type:"frame",layout:"horizontal",width:"fill_container",padding:[16,16],cornerRadius:12,fill:"#1E293B",alignItems:"center",gap:12})
t2_checkbox=I(task_item_2,{type:"frame",layout:"vertical",width:24,height:24,cornerRadius:6,border:"2px solid #64748B",alignItems:"center",justifyContent:"center"})
```

### Block 32
```
t2_title=I(task_item_2,{type:"text",text:"Review pull requests",fontSize:16,fontWeight:"500",fill:"#F1F5F9",textGrowth:"fixed-width",width:424})
t2_pomos=I(task_item_2,{type:"frame",layout:"horizontal",alignItems:"center",gap:4})
t2_pomos_text=I(t2_pomos,{type:"text",text:"0 / 2",fontSize:14,fontWeight:"600",fill:"#94A3B8"})
t2_actions=I(task_item_2,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"more-vertical",width:16,height:16,fill:"#64748B"})
```

### Block 33
```
task_item_3=I(task_list,{type:"frame",layout:"horizontal",width:"fill_container",padding:[16,16],cornerRadius:12,fill:"#0F172A",alignItems:"center",gap:12})
t3_checkbox=I(task_item_3,{type:"frame",layout:"vertical",width:24,height:24,cornerRadius:6,fill:"#10B981",alignItems:"center",justifyContent:"center"})
t3_check_icon=I(t3_checkbox,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"check",width:16,height:16,fill:"#FFFFFF"})
t3_title=I(task_item_3,{type:"text",text:"Daily Standup Prep",fontSize:16,fontWeight:"400",fill:"#64748B",textDecoration:"line-through",textGrowth:"fixed-width",width:424})
```

### Block 34
```
t3_pomos=I(task_item_3,{type:"frame",layout:"horizontal",alignItems:"center",gap:4})
t3_pomos_text=I(t3_pomos,{type:"text",text:"1 / 1",fontSize:14,fontWeight:"600",fill:"#64748B"})
t3_actions=I(task_item_3,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"more-vertical",width:16,height:16,fill:"#334155"})
stats_screen=I(document,{type:"frame",layout:"vertical",width:1440,height:1024,fill:"#0F172A",name:"Statistics Page"})
```

### Block 35
```
stats_nav=C(app_nav,stats_screen)
stats_main=I(stats_screen,{type:"frame",layout:"vertical",width:"fill_container",padding:[48,0],alignItems:"center"})
stats_container=I(stats_main,{type:"frame",layout:"vertical",width:800,gap:32})
stats_header=I(stats_container,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"space_between",alignItems:"center"})
```

### Block 36
```
stats_title=I(stats_header,{type:"text",text:"Your Activity",fontSize:28,fontWeight:"bold",fill:"#F1F5F9"})
stats_filter=I(stats_header,{type:"frame",layout:"horizontal",padding:[8,16],cornerRadius:8,fill:"#1E293B",alignItems:"center",gap:8})
stats_filter_text=I(stats_filter,{type:"text",text:"This Week",fontSize:14,fontWeight:"500",fill:"#F1F5F9"})
stats_filter_icon=I(stats_filter,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"chevron-down",width:16,height:16,fill:"#94A3B8"})
```

### Block 37
```
stats_cards=I(stats_container,{type:"frame",layout:"horizontal",width:"fill_container",gap:24})
scard1=I(stats_cards,{type:"frame",layout:"vertical",width:"fill_container",padding:[24,24],cornerRadius:16,fill:"#1E293B",gap:16})
scard1_header=I(scard1,{type:"frame",layout:"horizontal",alignItems:"center",gap:8})
scard1_icon=I(scard1_header,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"clock",width:20,height:20,fill:"#EF4444"})
```

### Block 38
```
scard1_title=I(scard1_header,{type:"text",text:"Hours Focused",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
scard1_value=I(scard1,{type:"text",text:"4.2h",fontSize:32,fontWeight:"bold",fill:"#F1F5F9"})
scard2=I(stats_cards,{type:"frame",layout:"vertical",width:"fill_container",padding:[24,24],cornerRadius:16,fill:"#1E293B",gap:16})
scard2_header=I(scard2,{type:"frame",layout:"horizontal",alignItems:"center",gap:8})
```

### Block 39
```
scard2_icon=I(scard2_header,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"target",width:20,height:20,fill:"#3B82F6"})
scard2_title=I(scard2_header,{type:"text",text:"Pomodoros Today",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
scard2_value=I(scard2,{type:"text",text:"10",fontSize:32,fontWeight:"bold",fill:"#F1F5F9"})
scard3=I(stats_cards,{type:"frame",layout:"vertical",width:"fill_container",padding:[24,24],cornerRadius:16,fill:"#1E293B",gap:16})
```

### Block 40
```
scard3_header=I(scard3,{type:"frame",layout:"horizontal",alignItems:"center",gap:8})
scard3_icon=I(scard3_header,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"flame",width:20,height:20,fill:"#F59E0B"})
scard3_title=I(scard3_header,{type:"text",text:"Day Streak",fontSize:14,fontWeight:"500",fill:"#94A3B8"})
scard3_value=I(scard3,{type:"text",text:"5",fontSize:32,fontWeight:"bold",fill:"#F1F5F9"})
```

### Block 41
```
chart_card=I(stats_container,{type:"frame",layout:"vertical",width:"fill_container",padding:[32,32],cornerRadius:16,fill:"#1E293B",gap:24})
chart_title=I(chart_card,{type:"text",text:"Focus Trend",fontSize:18,fontWeight:"600",fill:"#F1F5F9"})
chart_area=I(chart_card,{type:"frame",layout:"horizontal",width:"fill_container",height:240,alignItems:"end",justifyContent:"space_between",padding:[0,16]})
bar1_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
```

### Block 42
```
bar1=I(bar1_col,{type:"frame",layout:"vertical",width:40,height:120,cornerRadius:4,fill:"#334155"})
bar1_label=I(bar1_col,{type:"text",text:"Mon",fontSize:12,fill:"#94A3B8"})
bar2_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
bar2=I(bar2_col,{type:"frame",layout:"vertical",width:40,height:160,cornerRadius:4,fill:"#334155"})
```

### Block 43
```
bar2_label=I(bar2_col,{type:"text",text:"Tue",fontSize:12,fill:"#94A3B8"})
bar3_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
bar3=I(bar3_col,{type:"frame",layout:"vertical",width:40,height:90,cornerRadius:4,fill:"#334155"})
bar3_label=I(bar3_col,{type:"text",text:"Wed",fontSize:12,fill:"#94A3B8"})
```

### Block 44
```
bar4_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
bar4=I(bar4_col,{type:"frame",layout:"vertical",width:40,height:200,cornerRadius:4,fill:"#EF4444"})
bar4_label=I(bar4_col,{type:"text",text:"Thu",fontSize:12,fill:"#F1F5F9",fontWeight:"bold"})
bar5_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
```

### Block 45
```
bar5=I(bar5_col,{type:"frame",layout:"vertical",width:40,height:140,cornerRadius:4,fill:"#334155"})
bar5_label=I(bar5_col,{type:"text",text:"Fri",fontSize:12,fill:"#94A3B8"})
bar6_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
bar6=I(bar6_col,{type:"frame",layout:"vertical",width:40,height:40,cornerRadius:4,fill:"#334155"})
```

### Block 46
```
bar6_label=I(bar6_col,{type:"text",text:"Sat",fontSize:12,fill:"#94A3B8"})
bar7_col=I(chart_area,{type:"frame",layout:"vertical",alignItems:"center",gap:8})
bar7=I(bar7_col,{type:"frame",layout:"vertical",width:40,height:60,cornerRadius:4,fill:"#334155"})
bar7_label=I(bar7_col,{type:"text",text:"Sun",fontSize:12,fill:"#94A3B8"})
```

### Block 47
```
tooltip=I(chart_area,{type:"frame",layout:"vertical",padding:[8,12],cornerRadius:8,fill:"#0F172A",position:"absolute",x:420,y:10})
tooltip_text=I(tooltip,{type:"text",text:"8 Pomodoros",fontSize:12,fontWeight:"600",fill:"#F1F5F9"})
tooltip_arrow=I(tooltip,{type:"frame",layout:"none",width:8,height:8,fill:"#0F172A",rotation:45,position:"absolute",bottom:-4,left:40})
settings_screen=I(document,{type:"frame",layout:"vertical",width:1440,height:1024,fill:"#0F172A",name:"Settings Modal Overlay"})
```

### Block 48
```
settings_bg=I(settings_screen,{type:"frame",layout:"vertical",width:"fill_container",height:"fill_container",fill:"rgba(15, 23, 42, 0.8)",alignItems:"center",justifyContent:"center",position:"absolute",top:0,left:0})
settings_modal=I(settings_bg,{type:"frame",layout:"vertical",width:480,padding:[32,32],cornerRadius:16,fill:"#1E293B",gap:24,shadow:"0 20px 25px -5px rgba(0, 0, 0, 0.5)"})
settings_header=I(settings_modal,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"space_between",alignItems:"center"})
settings_title=I(settings_header,{type:"text",text:"Settings",fontSize:20,fontWeight:"bold",fill:"#F1F5F9"})
```

### Block 49
```
settings_close=I(settings_header,{type:"icon_font",iconFontFamily:"lucide",iconFontName:"x",width:24,height:24,fill:"#94A3B8"})
settings_section_timer=I(settings_modal,{type:"frame",layout:"vertical",width:"fill_container",gap:16})
st_title=I(settings_section_timer,{type:"text",text:"Timer (minutes)",fontSize:14,fontWeight:"600",fill:"#94A3B8",textTransform:"uppercase"})
st_inputs=I(settings_section_timer,{type:"frame",layout:"horizontal",width:"fill_container",gap:16})
```

### Block 50
```
st_pomo=I(st_inputs,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
st_pomo_label=I(st_pomo,{type:"text",text:"Pomodoro",fontSize:14,fill:"#F1F5F9"})
st_pomo_input=I(st_pomo,{type:"frame",layout:"horizontal",width:"fill_container",height:40,padding:[0,12],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
st_pomo_val=I(st_pomo_input,{type:"text",text:"25",fontSize:16,fill:"#F1F5F9"})
```

### Block 51
```
st_short=I(st_inputs,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
st_short_label=I(st_short,{type:"text",text:"Short Break",fontSize:14,fill:"#F1F5F9"})
st_short_input=I(st_short,{type:"frame",layout:"horizontal",width:"fill_container",height:40,padding:[0,12],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
st_short_val=I(st_short_input,{type:"text",text:"5",fontSize:16,fill:"#F1F5F9"})
```

### Block 52
```
st_long=I(st_inputs,{type:"frame",layout:"vertical",width:"fill_container",gap:8})
st_long_label=I(st_long,{type:"text",text:"Long Break",fontSize:14,fill:"#F1F5F9"})
st_long_input=I(st_long,{type:"frame",layout:"horizontal",width:"fill_container",height:40,padding:[0,12],cornerRadius:8,fill:"#0F172A",alignItems:"center"})
st_long_val=I(st_long_input,{type:"text",text:"15",fontSize:16,fill:"#F1F5F9"})
```

### Block 53
```
settings_divider=I(settings_modal,{type:"frame",layout:"horizontal",width:"fill_container",height:1,fill:"#334155"})
settings_section_sound=I(settings_modal,{type:"frame",layout:"vertical",width:"fill_container",gap:16})
ss_row=I(settings_section_sound,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"space_between",alignItems:"center"})
ss_label=I(ss_row,{type:"text",text:"Alarm Sound",fontSize:16,fontWeight:"500",fill:"#F1F5F9"})
```

### Block 54
```
ss_toggle=I(ss_row,{type:"frame",layout:"horizontal",width:44,height:24,cornerRadius:12,fill:"#10B981",padding:[2,2],alignItems:"center",justifyContent:"end"})
ss_toggle_knob=I(ss_toggle,{type:"frame",layout:"none",width:20,height:20,cornerRadius:10,fill:"#FFFFFF"})
settings_footer=I(settings_modal,{type:"frame",layout:"horizontal",width:"fill_container",justifyContent:"end",marginTop:16})
settings_save_btn=I(settings_footer,{type:"frame",layout:"horizontal",padding:[12,24],cornerRadius:8,fill:"#6366F1",alignItems:"center"})
```

### Block 55
```
settings_save_text=I(settings_save_btn,{type:"text",text:"Save Changes",fontSize:16,fontWeight:"600",fill:"#FFFFFF"})
```

## MCP Execution Results
chunk 1 FAILED: MCP error -32603: Request 'batch-design' timed out after 60000ms
chunk 2 FAILED: MCP error -32603: Request 'batch-design' timed out after 60000ms
chunk 3 FAILED: MCP error -32603: Request 'batch-design' timed out after 60000ms
chunk 4 FAILED: MCP error -32603: IPC server was disposed
chunk 5 FAILED: Not connected
chunk 6 FAILED: Not connected
chunk 7 FAILED: Not connected
chunk 8 FAILED: Not connected
chunk 9 FAILED: Not connected
chunk 10 FAILED: Not connected
chunk 11 FAILED: Not connected
chunk 12 FAILED: Not connected
chunk 13 FAILED: Not connected
chunk 14 FAILED: Not connected
chunk 15 FAILED: Not connected
chunk 16 FAILED: Not connected
chunk 17 FAILED: Not connected
chunk 18 FAILED: Not connected
chunk 19 FAILED: Not connected
chunk 20 FAILED: Not connected
chunk 21 FAILED: Not connected
chunk 22 FAILED: Not connected
chunk 23 FAILED: Not connected
chunk 24 FAILED: Not connected
chunk 25 FAILED: Not connected
chunk 26 FAILED: Not connected
chunk 27 FAILED: Not connected
chunk 28 FAILED: Not connected
chunk 29 FAILED: Not connected
chunk 30 FAILED: Not connected
chunk 31 FAILED: Not connected
chunk 32 FAILED: Not connected
chunk 33 FAILED: Not connected
chunk 34 FAILED: Not connected
chunk 35 FAILED: Not connected
chunk 36 FAILED: Not connected
chunk 37 FAILED: Not connected
chunk 38 FAILED: Not connected
chunk 39 FAILED: Not connected
chunk 40 FAILED: Not connected
chunk 41 FAILED: Not connected
chunk 42 FAILED: Not connected
chunk 43 FAILED: Not connected
chunk 44 FAILED: Not connected
chunk 45 FAILED: Not connected
chunk 46 FAILED: Not connected
chunk 47 FAILED: Not connected
chunk 48 FAILED: Not connected
chunk 49 FAILED: Not connected
chunk 50 FAILED: Not connected
chunk 51 FAILED: Not connected
chunk 52 FAILED: Not connected
chunk 53 FAILED: Not connected
chunk 54 FAILED: Not connected
chunk 55 FAILED: Not connected
