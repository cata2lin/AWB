"""
Application configuration using Pydantic Settings.
"""
import json
from typing import List, Dict
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Database
    database_url: str = "postgresql://postgres:123@localhost:5432/awbprint"
    
    # Frisbo API
    frisbo_api_url: str = "https://ingest.apis.store-view.frisbo.dev"
    frisbo_api_token: str = ""  # Legacy single token (backward compat)
    frisbo_org_tokens: str = "[]"  # JSON array of {name, token} objects
    
    # Rate limiting (20 req/sec as per Frisbo docs)
    frisbo_rate_limit: int = 20
    
    # Sync interval (minutes)
    sync_interval_minutes: int = 30
    
    # PDF Storage (relative path works for local dev)
    pdf_storage_path: str = "./storage"
    
    def get_org_tokens(self) -> List[Dict[str, str]]:
        """
        Parse and return all organization tokens.
        
        Returns a list of {name, token} dicts.
        Falls back to the legacy single token if FRISBO_ORG_TOKENS is empty.
        """
        try:
            tokens = json.loads(self.frisbo_org_tokens)
            if isinstance(tokens, list) and len(tokens) > 0:
                return tokens
        except (json.JSONDecodeError, TypeError):
            pass
        
        # Fallback: use legacy single token
        if self.frisbo_api_token:
            return [{"name": "default", "token": self.frisbo_api_token}]
        
        return []
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()
