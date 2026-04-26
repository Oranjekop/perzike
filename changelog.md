## 26.4.19

### Changed

- 按 Sparkle 的 Windows 安装更新方式调整安装脚本：更新时只停止并恢复系统服务，不再主动删除旧的 `resources\sidecar` 目录，避免旧目录 ACL 或占用导致安装中断
- 便携版更新前同步 Sparkle 的处理，检测并停止已安装的系统服务后再覆盖文件
