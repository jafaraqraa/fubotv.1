from fastapi import HTTPException, status

class RAGException(HTTPException):
    def __init__(self, error_code: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(
            status_code=status_code,
            detail={"error_code": error_code, "message": message}
        )

def raise_tenant_required():
    raise RAGException("TENANT_REQUIRED", "Tenant ID context is required", status.HTTP_400_BAD_REQUEST)

def raise_invalid_query(msg: str):
    raise RAGException("INVALID_QUERY", msg, status.HTTP_422_UNPROCESSABLE_ENTITY)

def raise_unauthorized():
    raise RAGException("UNAUTHORIZED", "Unauthorized tenant or principal access", status.HTTP_401_UNAUTHORIZED)
