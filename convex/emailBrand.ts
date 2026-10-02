function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function bodyToHtml(bodyText: string) {
  return bodyText
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) =>
      '<p style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.75;color:#3f3f46;">' +
      escapeHtml(paragraph).replace(/\n/g, "<br>") +
      "</p>"
    )
    .join("")
}

export function buildBrandedEmailHtml({ subject, bodyText }: { subject: string; bodyText: string }) {
  const safeSubject = escapeHtml(subject)
  const body = bodyToHtml(bodyText)
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f3f3f1;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f3f1;"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#0b0b0b;border:1px solid #2b2115;">' +
    '<tr><td style="padding:30px 38px;border-bottom:1px solid #6e531d;background:#0b0b0b;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1;font-weight:800;letter-spacing:5px;color:#ffffff;">JABARI</td>' +
    '<td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.4;font-weight:700;letter-spacing:3px;color:#d9ad3b;text-transform:uppercase;">Website Builder<br>&amp; Content Writer</td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:42px 50px 36px;background:#0d0d0d;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:2px;color:#d9ad3b;text-transform:uppercase;margin-bottom:16px;">A QUICK NOTE FROM JABARI</div>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:36px;line-height:1.12;font-weight:800;color:#ffffff;">' + safeSubject + '</div>' +
    '<div style="width:78px;height:4px;background:#d9ad3b;margin:28px 0 0;"></div>' +
    '</td></tr>' +
    '<tr><td style="padding:38px 50px;background:#ffffff;">' +
    body +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;"><tr><td style="border-radius:7px;background:#111111;border:1px solid #d9ad3b;">' +
    '<a href="https://jabari-tech.netlify.app" style="display:inline-block;padding:15px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">VISIT JABARI TECH&nbsp; →</a>' +
    '</td></tr></table></td></tr>' +
    '<tr><td style="padding:34px 42px;background:#0b0b0b;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#bdbdbd;margin-bottom:8px;">Best,</div>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;color:#ffffff;">Jabari</div>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.8;letter-spacing:2px;color:#d9ad3b;text-transform:uppercase;margin-top:9px;">Website Builder / Content Writer</div>' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.8;margin-top:15px;color:#8f8f8f;">jabari-tech.netlify.app &nbsp;·&nbsp; X: @King_Jabari_</div>' +
    '</td></tr></table></td></tr></table></body></html>'
}
