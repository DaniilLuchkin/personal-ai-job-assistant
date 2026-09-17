from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Orbit API"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://orbit:orbit@db:5432/orbit"
    orbit_api_token: str = ""
    orbit_user_email: str = ""
    orbit_user_password: str = ""
    session_days: int = 30
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    apify_api_key: str = ""
    apify_actor: str = ""
    cors_origins: str = "*"
    data_dir: str = "/app/data"

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
