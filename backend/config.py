from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    auth_mode: str = "local"
    data_backend: str = "sqlite"
    data_dir: Path = ROOT / "backend" / "data"
    firebase_project_id: str = ""
    firebase_storage_bucket: str = ""
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    ai_enabled: bool = True
    ai_free_tier_confirmed: bool = False
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""
    cloudflare_model: str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
    cloudflare_free_tier_confirmed: bool = False
    freellmapi_api_key: str = ""
    freellmapi_base_url: str = "http://127.0.0.1:3001/v1"
    freellmapi_model: str = "ministral-8b-latest"
    freellmapi_free_tier_confirmed: bool = False
    ai_daily_requests: int = Field(default=100, ge=1, le=1000)
    ai_max_output_tokens: int = Field(default=2400, ge=512, le=4096)
    redis_url: str = ""
    max_upload_bytes: int = 10 * 1024 * 1024
    worker_enabled: bool = True
    ocr_enabled: bool = True
    ocr_max_pages: int = Field(default=100, ge=1, le=200)

    def validate_modes(self):
        if self.auth_mode not in ("local", "firebase") or self.data_backend not in (
            "sqlite",
            "firestore",
        ):
            raise RuntimeError(
                "Use AUTH_MODE=local|firebase and DATA_BACKEND=sqlite|firestore."
            )
        if self.data_backend == "firestore" and self.auth_mode != "firebase":
            raise RuntimeError("Firestore requires Firebase authentication.")


settings = Settings()
