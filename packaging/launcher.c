/* 稳定原生入口直接选择当前完整版本，旧运行时只用于人工恢复。 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 指针只能引用受管目录；拒绝盘符、反斜杠、路径穿越和任意绝对路径。 */
static int valid_pointer(char *value) {
  value[strcspn(value, "\r\n")] = 0;
  if (!strcmp(value, ".")) return 1;
  if (strncmp(value, ".relay-update/versions/", 23) || strstr(value, "..")) return 0;
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') ||
          (*p >= '0' && *p <= '9') || strchr("/.-+", *p))) return 0;
  }
  return 1;
}
#ifdef _WIN32
#include <windows.h>
#include <wchar.h>

/* 按 Windows 命令行规则转义引号与末尾反斜杠。 */
static void quote(wchar_t **out, const wchar_t *value) {
  *(*out)++ = L'"';
  while (*value) {
    unsigned slash = 0;
    while (*value == L'\\') { slash++; value++; }
    if (*value == L'"') {
      for (unsigned i = 0; i < slash * 2 + 1; i++) *(*out)++ = L'\\';
      *(*out)++ = *value++;
    } else if (!*value) {
      for (unsigned i = 0; i < slash * 2; i++) *(*out)++ = L'\\';
      break;
    } else {
      for (unsigned i = 0; i < slash; i++) *(*out)++ = L'\\';
      *(*out)++ = *value++;
    }
  }
  *(*out)++ = L'"'; *(*out)++ = L' ';
}
int wmain(int argc, wchar_t **argv) {
  wchar_t root[32768], selected[32768], pointer[32768], node[32768], entry[32768];
  DWORD n = GetModuleFileNameW(NULL, root, 32768);
  if (!n || n >= 32768) return 1;
  wchar_t *end = wcsrchr(root, L'\\'); if (!end) return 1; *end = 0;
#ifdef BUGPAW_LOGIN
  /* 登录入口可来自薄更新版本目录，始终用稳定安装根选择当前版本。 */
  if (argc != 5 || wcscmp(argv[2], L"start") || wcscmp(argv[3], L"--data-home") || wcslen(argv[1]) >= 32768) return 1;
  wcscpy(root, argv[1]);
  argv++; argc--;
  DWORD creation_flags = CREATE_NO_WINDOW;
#else
  DWORD creation_flags = 0;
#endif
  if (wcslen(root) > 28000 || !SetEnvironmentVariableW(L"BUGPAW_INSTALL_ROOT", root)) return 1;
  wcscpy(selected, root);
  /* 全局语言参数不能改变恢复命令的路由，校验仍由 CLI 完成。 */
  int command = 1;
  while (command < argc) {
    if (!wcscmp(argv[command], L"--lang") || !wcscmp(argv[command], L"--data-home")) command += 2;
    else if (!wcscmp(argv[command], L"--cli")) command++;
    else break;
  }
  int recovery = argc > command && (!wcscmp(argv[command], L"update-recover") || !wcscmp(argv[command], L"update-supervise"));
  swprintf(pointer, 32768, L"%ls\\.relay-update\\current.txt", root);
  FILE *file = recovery ? NULL : _wfopen(pointer, L"rb");
  if (file) {
    char path[4096]; size_t count = fread(path, 1, sizeof(path) - 1, file);
    int extra = fgetc(file); fclose(file); path[count] = 0;
    if (extra != EOF || !valid_pointer(path)) return 1;
    if (strcmp(path, ".")) {
      wchar_t wide[4096];
      if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, path, -1, wide, 4096)) return 1;
      swprintf(selected, 32768, L"%ls\\%ls", root, wide);
    }
  } else if (!recovery && GetFileAttributesW(pointer) != INVALID_FILE_ATTRIBUTES) return 1;
  swprintf(node, 32768, L"%ls\\runtime\\node.exe", selected);
  swprintf(entry, 32768, L"%ls\\app\\dist\\connector\\main.js", selected);
  size_t capacity = 2 * (wcslen(node) + wcslen(entry)) + 16;
  for (int i = 1; i < argc; i++) capacity += 2 * wcslen(argv[i]) + 4;
  if (capacity > 32767) return 1;
  wchar_t *line = calloc(capacity, sizeof(wchar_t)), *cursor = line;
  if (!line) return 1;
  quote(&cursor, node); quote(&cursor, entry);
  for (int i = 1; i < argc; i++) quote(&cursor, argv[i]);
  *cursor = 0;
  STARTUPINFOW si = {0}; si.cb = sizeof(si); PROCESS_INFORMATION pi = {0};
  if (!CreateProcessW(node, line, NULL, NULL, TRUE, creation_flags, NULL, NULL, &si, &pi)) {
    fwprintf(stderr, L"Cannot start bundled runtime / 无法启动随包运行时: %lu\n", GetLastError()); free(line); return 1;
  }
  free(line); CloseHandle(pi.hThread); WaitForSingleObject(pi.hProcess, INFINITE);
  DWORD code = 1; GetExitCodeProcess(pi.hProcess, &code); CloseHandle(pi.hProcess); return (int)code;
}
#else
#include <unistd.h>
#include <limits.h>
#include <errno.h>

int main(int argc, char **argv) {
  char root[PATH_MAX], selected[PATH_MAX], pointer[PATH_MAX], node[PATH_MAX], entry[PATH_MAX];
  ssize_t n = readlink("/proc/self/exe", root, sizeof(root) - 1);
  if (n < 0 || n >= sizeof(root) - 1) return 1;
  root[n] = 0; char *end = strrchr(root, '/'); if (!end) return 1; *end = 0;
  if (setenv("BUGPAW_INSTALL_ROOT", root, 1)) return 1;
  strcpy(selected, root);
  /* 全局语言参数不能改变恢复命令的路由，校验仍由 CLI 完成。 */
  int command = 1;
  while (command < argc) {
    if (!strcmp(argv[command], "--lang") || !strcmp(argv[command], "--data-home")) command += 2;
    else if (!strcmp(argv[command], "--cli")) command++;
    else break;
  }
  int recovery = argc > command && (!strcmp(argv[command], "update-recover") || !strcmp(argv[command], "update-supervise"));
  if (snprintf(pointer, sizeof(pointer), "%s/.relay-update/current.txt", root) >= sizeof(pointer)) return 1;
  FILE *file = recovery ? NULL : fopen(pointer, "rb");
  if (file) {
    char path[4096]; size_t count = fread(path, 1, sizeof(path) - 1, file);
    int extra = fgetc(file); fclose(file); path[count] = 0;
    if (extra != EOF || !valid_pointer(path)) return 1;
    if (strcmp(path, ".") && snprintf(selected, sizeof(selected), "%s/%s", root, path) >= sizeof(selected)) return 1;
  } else if (!recovery && errno != ENOENT) return 1;
  if (snprintf(node, sizeof(node), "%s/runtime/node", selected) >= sizeof(node) ||
      snprintf(entry, sizeof(entry), "%s/app/dist/connector/main.js", selected) >= sizeof(entry)) return 1;
  char **args = calloc(argc + 2, sizeof(char *)); if (!args) return 1;
  args[0] = node; args[1] = entry;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv(node, args); perror("Cannot start bundled runtime / 无法启动随包运行时"); free(args); return 1;
}
#endif
