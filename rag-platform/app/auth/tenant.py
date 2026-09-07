from fastapi import Request, Header, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional

class PrincipalContext(BaseModel):
    tenant_id: str
    user_id: Optional[str] = None
    roles: List[str] = ["employee"]
    department: Optional[str] = None
    security_level: str = "internal"

def get_principal_context(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    x_user_id: Optional[str] = Header(None, alias="X-User-ID"),
    x_roles: Optional[str] = Header(None, alias="X-Roles"),
    x_department: Optional[str] = Header(None, alias="X-Department"),
) -> PrincipalContext:
    if not x_tenant_id or x_tenant_id.strip() == "":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error_code": "TENANT_REQUIRED", "message": "X-Tenant-ID header is required"}
        )

    roles_list = [r.strip() for r in x_roles.split(",")] if x_roles else ["employee"]
    return PrincipalContext(
        tenant_id=x_tenant_id.strip(),
        user_id=x_user_id.strip() if x_user_id else None,
        roles=roles_list,
        department=x_department.strip() if x_department else None
    )
