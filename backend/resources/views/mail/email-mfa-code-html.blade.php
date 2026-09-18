{{--
    HTML part of EmailMfaCodeMail. The plain-text part (email-mfa-code.blade.php)
    is still sent alongside it, so a client that shows text only, or a reader
    who prefers it, receives the same content.

    Deliberately an official system notice, not a marketing message: no images,
    no tracking pixels, no remote fonts, no links (a link would put the secret
    in a URL — see EmailMfaCodeMail), and no personal information beyond what
    the recipient already knows. Table layout and inline styles only, because
    that is what renders consistently across Gmail, Outlook and mobile clients.
    Every value is escaped with {{ }}.
--}}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>CDARS sign-in verification code</title>
</head>
<body style="margin:0; padding:0; background-color:#FAFBF7; font-family:Arial, Helvetica, sans-serif; color:#22291F;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">Your CDARS sign-in verification code. It expires in {{ $expiresInMinutes }} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFBF7;">
    <tr>
        <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px; background-color:#FFFFFF; border:1px solid #DCEBDD; border-radius:8px;">
                {{-- Header --}}
                <tr>
                    <td style="border-top:4px solid #2E8B47; border-radius:8px 8px 0 0; padding:24px 32px 18px 32px; border-bottom:1px solid #EAF6EC;">
                        <p style="margin:0; font-size:22px; line-height:28px; font-weight:bold; letter-spacing:2px; color:#1E5C31;">CDARS</p>
                        <p style="margin:2px 0 0 0; font-size:13px; line-height:18px; color:#22291F;">Crime Data Analytics and Reporting System</p>
                        <p style="margin:2px 0 0 0; font-size:12px; line-height:17px; color:#62705F;">Barangay 178 Public Safety and Security</p>
                    </td>
                </tr>

                @if ($isLocal)
                <tr>
                    <td style="padding:12px 32px 0 32px;">
                        <p style="margin:0; padding:8px 12px; background-color:#FFF3E9; border:1px solid #FF8A3D; border-radius:6px; font-size:12px; line-height:17px; color:#9A4A08; font-weight:bold;">LOCAL DEVELOPMENT AUTHENTICATION CODE — sent by a local development copy of CDARS.</p>
                    </td>
                </tr>
                @endif

                {{-- Main --}}
                <tr>
                    <td style="padding:28px 32px 8px 32px;">
                        <h1 style="margin:0; font-size:19px; line-height:26px; font-weight:bold; color:#22291F;">Your sign-in verification code</h1>
                        <p style="margin:8px 0 0 0; font-size:14px; line-height:21px; color:#3D473A;">Enter this code on the CDARS sign-in screen to finish signing in.</p>
                    </td>
                </tr>
                <tr>
                    <td align="center" style="padding:20px 32px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                                <td align="center" style="background-color:#EAF6EC; border:1px solid #CFE5D2; border-radius:8px; padding:16px 28px;">
                                    <span style="font-family:'Courier New', Courier, monospace; font-size:34px; line-height:40px; font-weight:bold; letter-spacing:10px; color:#1E5C31;">{{ $code }}</span>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td style="padding:0 32px 8px 32px;">
                        <p style="margin:0; font-size:14px; line-height:21px; color:#22291F;">This code expires in <strong>{{ $expiresInMinutes }} minutes</strong> (at {{ $expiresAt }}) and can be used only once.</p>
                        <p style="margin:10px 0 0 0; font-size:14px; line-height:21px; color:#22291F;"><strong>Do not share this code with anyone.</strong> CDARS administrators will never ask you for it.</p>
                    </td>
                </tr>

                {{-- Security notice --}}
                <tr>
                    <td style="padding:16px 32px 28px 32px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                                <td style="border-left:3px solid #FF8A3D; background-color:#FAFBF7; padding:12px 14px; font-size:13px; line-height:19px; color:#3D473A;">
                                    <strong style="color:#22291F;">Security notice</strong><br>
                                    If you did not attempt to sign in to CDARS, you can safely ignore this email. If this keeps happening, someone may know your password — change it and inform your administrator.
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>

                {{-- Footer --}}
                <tr>
                    <td style="padding:16px 32px 22px 32px; border-top:1px solid #EAF6EC;">
                        <p style="margin:0; font-size:12px; line-height:17px; color:#62705F;">Barangay 178 Public Safety and Security</p>
                        <p style="margin:0; font-size:12px; line-height:17px; color:#62705F;">Crime Data Analytics and Reporting System</p>
                        <p style="margin:8px 0 0 0; font-size:11px; line-height:16px; color:#62705F;">This is an automated security message.</p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
