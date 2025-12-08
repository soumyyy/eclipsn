from functools import lru_cache
from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL", default="postgres://pluto:pluto@localhost:5432/pluto")
    openai_api_key: str = Field(alias="OPENAI_API_KEY", default="")
    enable_openai: bool = Field(alias="BRAIN_ENABLE_OPENAI", default=False)

    class Config:
        env_file = Path(__file__).resolve().parents[2] / '.env'
        env_file_encoding = 'utf-8'
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
