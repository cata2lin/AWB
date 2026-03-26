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
    
    # JWT Auth
    jwt_secret_key: str = "changeme"
    jwt_expiry_hours: int = 24
    
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
    
    def get_org_token_map(self) -> Dict[str, Dict[str, str]]:
        """
        Build a mapping of organization_uid -> {name, token} by decoding the JWT payloads.
        
        Each Frisbo JWT contains the org_uid in its payload:
          {"iat": ..., "organization_uid": "..."}
        """
        import base64
        result = {}
        for t in self.get_org_tokens():
            try:
                payload = t["token"].split(".")[1]
                payload += "=" * (4 - len(payload) % 4)  # pad base64
                decoded = json.loads(base64.b64decode(payload))
                org_uid = decoded.get("organization_uid")
                if org_uid:
                    result[org_uid] = t
            except Exception:
                continue
        return result
    
    def get_token_for_org(self, org_uid: str) -> Dict[str, str]:
        """Find the correct token config for a given organization_uid. Falls back to first token."""
        org_map = self.get_org_token_map()
        return org_map.get(org_uid, self.get_org_tokens()[0] if self.get_org_tokens() else {})
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()
