#!/usr/bin/env bash
set -euo pipefail
# 兼容旧入口：仅下载完整发布包，不安装 npm 依赖。
# 默认值由服务端依据部署配置和当前发行清单生成，源码不包含私人地址。
default_server_url='__BUGPAW_SERVER_URL__'
default_package='__BUGPAW_PACKAGE__'
server_url="${BUGPAW_SERVER_URL:-$default_server_url}"
package="${BUGPAW_PACKAGE:-$default_package}"
if [[ "$server_url" == __BUGPAW_* || "$package" == __BUGPAW_* ]]; then
  echo '请从已部署的服务下载安装脚本，或设置 BUGPAW_SERVER_URL 和 BUGPAW_PACKAGE。' >&2
  exit 1
fi
install_dir="${BUGPAW_INSTALL_DIR:-$HOME/.local/share/bugpaw-relay}"
[ "$(uname -m)" = x86_64 ] || { echo '当前发布包仅支持 x64'; exit 1; }
# 登录接入页面获取临时凭证，不在脚本中保存登录 token。
download_grant="${BUGPAW_DOWNLOAD_GRANT:-}"
[ -n "$download_grant" ] || { echo '请先登录获取安装包临时授权，设置 BUGPAW_DOWNLOAD_GRANT 后重试。' >&2; exit 1; }
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
curl -fL "$server_url/downloads/$package?grant=$download_grant" -o "$temporary/$package"
curl -fsSL "$server_url/downloads/$package.sha256?grant=$download_grant" -o "$temporary/$package.sha256"
(cd "$temporary" && sha256sum -c "$package.sha256")
mkdir -p "$install_dir"
tar -xzf "$temporary/$package" -C "$install_dir" --strip-components=1
printf '发布包已解压，运行：\n%s/bugpaw-relay\n' "$install_dir"
