from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.config.config_service import ConfigurationService

router = APIRouter(prefix="/v1/config", tags=["Configuration"])

@router.post("/test", status_code=status.HTTP_200_OK)
async def test_configuration(db: Session = Depends(get_db)):
    service = ConfigurationService(db)
    res = await service.test_configuration()
    return res
