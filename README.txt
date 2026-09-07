PhD Tracker V1.3.1
===================

本版本专门修复 V1.3 在部分手机浏览器中 Supabase 登录长期停留在“正在登录”的问题。

V1.3.1 修复内容
----------------
1. Supabase JS 从浮动 @2 改为固定版本 2.112.2，避免 CDN 自动升级导致行为变化。
2. 账号登录增加 15 秒超时保护，任何情况下都不会无限显示“正在登录”。
3. 手机端首次登录超时时，会自动重建 Supabase 客户端并重试一次。
4. 将“账号验证”和“云端数据同步”拆成两个状态：登录成功后即明确显示账号已登录；即使同步较慢，也不会误显示为还在登录。
5. 登录状态检查增加 8 秒超时；Safari/Chrome 恢复后台页面时进行非阻塞会话检查。
6. 云端首次同步增加 20 秒保护；超时后仍保留已登录状态和本地数据，可手动“立即双向同步”。
7. 连接测试改为实际请求 Supabase Auth 设置接口，并带 10 秒超时。

数据与 Supabase 兼容
-------------------
- 数据表仍为 public.phd_tracker_state。
- localStorage 数据键仍为 phdTrackerV1。
- Supabase 配置键仍为 phdTrackerSupabaseConfigV1。
- V1.3 已有云端记录、账号、密码和 RLS 规则全部继续使用。
- 不需要重新创建 Supabase Project。
- 不需要重新运行 supabase_setup.sql（除非你之前从未运行成功）。
- 不需要重新注册账号。

GitHub Pages 升级
-----------------
解压 V1.3.1 后，将以下文件上传并覆盖 GitHub 仓库根目录的同名文件：
  index.html
  app.js
  style.css
  manifest.json
  README.txt
  supabase-config.js

然后 Commit changes。原 GitHub Pages 地址保持不变。等待部署完成后，在手机和电脑上重新打开网页；如仍显示旧版本，请强制刷新或清除此站点的网页缓存。

安全说明
--------
继续只使用 Supabase Publishable key / anon key。绝对不要把 Secret key 或 service_role key 放到前端。
