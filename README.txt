PhD Tracker V1.3.2
===================

本版目的
--------
修复 Chrome / Safari / 密码管理器把登录邮箱误填到“实时计时器标签、项目、任务”等非账号字段的问题，同时完整保留 V1.3.1 的 Supabase 多设备同步与手机端登录修复。

V1.3.2 新增修复
---------------
1. 所有非账号输入字段统一加入 autocomplete="off"。
2. 为非账号字段使用独立字段名，降低浏览器把它们识别为账号字段的概率。
3. 对任务、项目、标签、新建类别、新建项目、备忘录、日期/时间、Supabase 配置等字段加入：
   - data-lpignore="true"（LastPass）
   - data-1p-ignore="true"（1Password）
   - data-bwignore="true"（Bitwarden）
4. 增加 WebKit / Chrome autofill 检测。如果浏览器仍把邮箱误填到任务、项目、标签等高风险字段，会自动清除该误填值。
5. “正在做什么 / 项目 / 标签 / 新建类别 / 新建项目 / 备忘录 / 添加时间记录”等非账号文本框同时关闭 autocorrect、autocapitalize 和 spellcheck，减少移动端输入干扰。
6. 真正的登录邮箱与密码仍保留：
   - autocomplete="email"
   - autocomplete="current-password"
   因此 Chrome / Safari / 密码管理器仍可正常帮你填写真正的登录账号。

保留的 V1.3.1 功能
-----------------
- Supabase JS 固定版本与手机端登录超时保护。
- 手机端登录失败自动恢复，不再无限停留“正在登录”。
- 本地缓存 + Supabase 多设备同步。
- 实时计时器、年度科研热力图、项目/论文统计、日历、备忘录。

数据兼容
--------
- localStorage 键仍为 phdTrackerV1。
- Supabase 配置键仍为 phdTrackerSupabaseConfigV1。
- 云端表仍为 public.phd_tracker_state。
- 不需要重新创建 Supabase Project。
- 不需要重新运行 supabase_setup.sql（除非之前没有成功执行）。
- 不需要重新注册账号。
- V1.3 / V1.3.1 已有本地和云端数据保持兼容。

GitHub Pages 升级
-----------------
将以下文件上传到 GitHub 仓库根目录并覆盖同名文件：
  index.html
  app.js
  style.css
  manifest.json
  README.txt
  supabase-config.js

然后点击 Commit changes。GitHub Pages 地址保持不变。
部署完成后建议手机端彻底关闭旧页面后重新打开；若还显示旧版本，可清除此网站缓存后重试。

安全说明
--------
浏览器前端只使用 Supabase Publishable key / anon key。
绝对不要把 Secret key 或 service_role key 放到 GitHub Pages 前端。
