"""Minimal Brevo transactional email client for account actions."""

import httpx


class BrevoMailer:
    def __init__(self, api_key, sender_email, sender_name):
        self.api_key = api_key
        self.sender_email = sender_email
        self.sender_name = sender_name

    @property
    def configured(self):
        return bool(self.api_key and self.sender_email)

    def send(self, recipient, subject, html_content, text_content):
        if not self.configured:
            raise RuntimeError("Brevo email sending is not configured.")
        try:
            response = httpx.post(
                "https://api.brevo.com/v3/smtp/email",
                headers={"api-key": self.api_key, "accept": "application/json"},
                json={
                    "sender": {"name": self.sender_name, "email": self.sender_email},
                    "to": [{"email": recipient}],
                    "subject": subject,
                    "htmlContent": html_content,
                    "textContent": text_content,
                },
                timeout=15,
            )
            response.raise_for_status()
        except httpx.HTTPError:
            # Do not include provider responses or credentials in API errors/logs.
            raise RuntimeError("Brevo could not send the account email.") from None
