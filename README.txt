PhD Tracker V1.3.3
===================

本版目的
--------
从网页结构上解决 Chrome / Safari / Google Password Manager / 第三方密码管理器把“备忘录、标签、项目、任务”等业务字段误识别为账号或密码的问题。

V1.3.3 核心修复：Credential Isolation
-------------------------------------
1. Supabase 邮箱和密码输入框不再常驻主页面 DOM。
2. 设置页未登录时只显示“登录 / 注册”按钮，不存在 email/password 输入框。
3. 只有用户主动点击“登录 / 注册”时，网页才动态创建独立登录 Modal。
4. 登录成功、注册完成、取消或关闭 Modal 后：
   - 清空邮箱和密码值；
   - 删除整个登录表单；
   - 从 DOM 中彻底移除 credential input。
5. 已登录状态只显示账号邮箱、上次同步时间、同步按钮和退出按钮，不保留密码输入框。
6. 以下业务区域分别使用独立表单结构：
   - 实时计时器 timerForm
   - 当天备忘 dayMemoForm
   - 独立备忘录 memoForm
   - 时间记录 activityForm
   - 新建类别 categoryForm
   - 新建项目 projectForm
7. 所有非账号输入字段继续保留第二道防线：
   - autocomplete="off"
   - data-lpignore="true"
   - data-1p-ignore="true"
   - data-bwignore="true"
   - 移动端 autocorrect / autocapitalize / spellcheck 控制
8. 仅真正的临时登录表单使用：
   - autocomplete="email"
   - autocomplete="current-password"

保留的 V1.3.2 / V1.3.1 功能
----------------------------
- Supabase 多设备自动同步。
- 手机端登录 15 秒超时保护及自动恢复。
- Supabase JS 固定版本。
- 本地缓存模式。
- 实时计时器。
- GitHub 风格年度科研热力图。
- 项目 / 论文维度统计。
- 日历、当天备忘、独立备忘录。
- JSON 导入 / 导出备份。

数据兼容
--------
- localStorage 键仍为 phdTrackerV1。
- Supabase 配置键仍为 phdTrackerSupabaseConfigV1。
- 云端表仍为 public.phd_tracker_state。
- 不需要重新创建 Supabase Project。
- 不需要重新运行 supabase_setup.sql（如果 V1.3 已成功执行过）。
- 不需要重新注册 Supabase 账号。
- V1.3 / V1.3.1 / V1.3.2 的本地数据和云端数据保持兼容。

GitHub Pages 升级
-----------------
将以下文件上传到 GitHub 仓库根目录并覆盖同名文件：
  index.html
  app.js
  style.css
  manifest.json
  README.txt
  supabase-config.js

然后 Commit changes。GitHub Pages 地址保持不变。
部署完成后建议：
1. 等待 GitHub Pages 部署完成；
2. 手机端彻底关闭旧页面；
3. 重新打开网站；
4. 若仍看到旧版本，清除该网站缓存或执行强制刷新。

安全说明
--------
浏览器前端只使用 Supabase Publishable key / legacy anon key。
绝对不要把 Secret key 或 service_role key 放到 GitHub Pages 前端。
