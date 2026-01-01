// AS3 Branded Email Template for User Invitations
// Brand colors: #C10230 (red), #119DA4 (teal)

interface EmailTemplateParams {
  inviteeName: string
  inviterName: string
  role: string
  roleDescription: string
  inviteUrl: string
  expiresDate: string
}

export function getInvitationEmailHtml(params: EmailTemplateParams): string {
  const { inviteeName, inviterName, role, roleDescription, inviteUrl, expiresDate } = params

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to AS3 Expense Dashboard</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">

          <!-- Header with AS3 branding -->
          <tr>
            <td style="background-color: #C10230; padding: 32px 40px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                AS3 Driver Training
              </h1>
              <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                Expense Dashboard
              </p>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px;">
              <!-- Greeting -->
              <h2 style="margin: 0 0 16px 0; color: #18181b; font-size: 24px; font-weight: 600;">
                Hello ${inviteeName}!
              </h2>

              <p style="margin: 0 0 24px 0; color: #52525b; font-size: 16px; line-height: 1.6;">
                ${inviterName} has invited you to join the <strong>AS3 Expense Dashboard</strong> as a <strong style="color: #119DA4;">${roleLabel}</strong>.
              </p>

              <!-- Role description box -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="background-color: #f0fdfa; border-left: 4px solid #119DA4; padding: 16px 20px; border-radius: 0 4px 4px 0;">
                    <p style="margin: 0 0 4px 0; color: #115e59; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      Your Access Level
                    </p>
                    <p style="margin: 0; color: #134e4a; font-size: 14px; line-height: 1.5;">
                      ${roleDescription}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 32px 0;">
                <tr>
                  <td style="text-align: center;">
                    <a href="${inviteUrl}" target="_blank" style="display: inline-block; background-color: #119DA4; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; padding: 14px 32px; border-radius: 6px; box-shadow: 0 2px 4px rgba(17, 157, 164, 0.3);">
                      Set Up My Account
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Expiration notice -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="background-color: #fef9c3; padding: 12px 16px; border-radius: 6px; text-align: center;">
                    <p style="margin: 0; color: #854d0e; font-size: 13px;">
                      <strong>Important:</strong> This invitation expires on ${expiresDate}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Help text -->
              <p style="margin: 24px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.6;">
                If the button above doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0 0; word-break: break-all;">
                <a href="${inviteUrl}" style="color: #119DA4; font-size: 13px; text-decoration: underline;">
                  ${inviteUrl}
                </a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #27272a; padding: 24px 40px; border-radius: 0 0 8px 8px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; color: #a1a1aa; font-size: 13px;">
                      AS3 Driver Training
                    </p>
                    <p style="margin: 0 0 16px 0; color: #71717a; font-size: 12px;">
                      Professional Driver Training Services
                    </p>
                    <p style="margin: 0; color: #52525b; font-size: 11px; line-height: 1.5;">
                      If you didn't expect this invitation or believe it was sent in error,<br>
                      please contact <a href="mailto:support@as3drivertraining.com" style="color: #119DA4; text-decoration: none;">support@as3drivertraining.com</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}
