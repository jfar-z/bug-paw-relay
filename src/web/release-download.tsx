import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { useState, type ReactNode } from "react";
import { api, Button, ErrorBox } from "./ui/index.js";

/** 点击时才签发短期授权，不把登录凭据放进链接或安装脚本。 */
export function ReleaseDownload({
  file,
  children,
}: {
  file: string;
  children: ReactNode;
}) {
  useLocale();
  const [grant, setGrant] = useState<{
    url: string;
    grant: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState<UiFeedback>("");
  const [copied, setCopied] = useState(false);
  async function download() {
    setError("");
    setCopied(false);
    try {
      const value = await api("/connector-downloads", { file });
      setGrant(value);
      const link = document.createElement("a");
      link.href = value.url;
      link.download = file;
      link.click();
    } catch (e) {
      setError(caughtFeedback(e as Error));
    }
  }
  return (
    <div>
      <Button onClick={download}>{children}</Button>
      {grant && (
        <div className="sub">
          <a href={grant.url} download={file}>
            {tr("web.temporaryDownloadLink")}
          </a>{" "}
          {tr("web.validUntil")}
          {new Date(grant.expiresAt).toLocaleTimeString(currentLocale())}
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(grant.grant);
                setCopied(true);
              } catch {
                setError(feedback("web.copyFailedUseTheTemporaryDownloadLink"));
              }
            }}
          >
            {copied
              ? tr("web.installationAuthorizationCopied")
              : tr("web.copyInstallationAuthorization")}
          </Button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
