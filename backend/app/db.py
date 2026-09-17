from collections.abc import Generator
from sqlalchemy import JSON, DateTime, String, UniqueConstraint, create_engine, func
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from .config import settings


class Base(DeclarativeBase):
    pass


class Record(Base):
    __tablename__ = "records"
    __table_args__ = (UniqueConstraint("entity_type", "entity_id", name="uq_record_entity"),)

    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[str] = mapped_column(String(180))
    payload: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
