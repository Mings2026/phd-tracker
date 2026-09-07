PhD Tracker V1.3
=================

基于 V1.2 新增 Supabase 多设备共享：
1. 邮箱 + 密码注册/登录。
2. 同一个账号在电脑、手机、不同浏览器共享同一份数据。
3. 保留本地缓存；未登录/断网时仍可使用。
4. 本地改动自动上传，页面重新获得焦点、重新联网或定期检查时自动拉取云端更新。
5. 首次登录自动合并 V1.2 本地数据与云端数据。
6. 活动/备忘录支持跨设备合并和删除标记，降低旧设备恢复已删除数据的风险。
7. 设置页提供：立即双向同步 / 强制上传本机 / 强制下载云端。
8. 保留 V1.2 全部功能：实时计时器、年度科研热力图、项目/论文维度统计、日历、备忘录、统计、JSON 备份。

升级兼容：
继续使用 localStorage 存储键 phdTrackerV1，同一浏览器从 V1.2 覆盖升级时原数据不会主动清空。

部署：
将 index.html、app.js、style.css、manifest.json、README.txt、supabase-config.js 上传并覆盖 GitHub 仓库根目录中的同名文件，然后 Commit changes。

第一次启用云同步：
请严格按照 SUPABASE_SETUP.txt 操作，并在 Supabase SQL Editor 运行 supabase_setup.sql。
