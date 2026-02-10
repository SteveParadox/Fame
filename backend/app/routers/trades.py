"""Trade API routes (MVP off-chain).

This exposes a minimal endpoint to record buy/sell activity in the `trades`
table and update the user's off-chain token balance via `wallet_ledger`.

It also publishes realtime events so the frontend can update charts and show
notifications.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from pydantic import BaseModel

from .. import models, schemas
from ..auth import get_current_active_user
from ..database import SessionLocal
from ..realtime import publish_event_sync
from ..notifier import notify_sync
from ..pricing import execute_trade

from decimal import Decimal


router = APIRouter(prefix="/trades")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class TradeCreate(BaseModel):
    influencer_id: int
    amount: float
    trade_type: str  # buy/sell


@router.post("", status_code=status.HTTP_201_CREATED)
def create_trade(
    payload: TradeCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Record a trade and update wallet ledger.

    Pricing is computed server-side via the off-chain pricing engine.
    """
    influencer = db.query(models.Influencer).filter(models.Influencer.id == payload.influencer_id).first()
    if not influencer:
        raise HTTPException(status_code=404, detail="Influencer not found")

    ttype = (payload.trade_type or "").lower()
    if ttype not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="trade_type must be 'buy' or 'sell'")

    amount_f = float(payload.amount)
    if amount_f <= 0:
        raise HTTPException(status_code=400, detail="amount must be positive")

    # Sells must not exceed the user's current balance
    if ttype == "sell":
        bal_rows = (
            db.query(models.WalletLedger.amount)
            .filter(models.WalletLedger.user_id == current_user.id, models.WalletLedger.influencer_id == payload.influencer_id)
            .all()
        )
        balance = sum(Decimal(str(r[0])) for r in bal_rows) if bal_rows else Decimal("0")
        if Decimal(str(amount_f)) > balance:
            raise HTTPException(status_code=400, detail="Insufficient token balance")

    quote = execute_trade(db, payload.influencer_id, Decimal(str(amount_f)), ttype)
    price = float(quote.avg_price)

    trade = models.Trade(
        user_id=current_user.id,
        influencer_id=payload.influencer_id,
        amount=Decimal(str(amount_f)),
        price=Decimal(str(quote.avg_price)),
        trade_type=ttype,
    )
    db.add(trade)

    # Update off-chain ledger: buys add, sells subtract
    delta = Decimal(str(amount_f)) if ttype == "buy" else -Decimal(str(amount_f))
    entry = models.WalletLedger(
        user_id=current_user.id,
        influencer_id=payload.influencer_id,
        amount=delta,
    )
    db.add(entry)

    db.commit()
    db.refresh(trade)

    publish_event_sync(
        {
            "type": "trade.created",
            "trade_id": trade.id,
            "user_id": current_user.id,
            "influencer_id": payload.influencer_id,
            "amount": float(amount_f),
            "price": price,
            "new_price": float(quote.new_price),
            "new_supply": float(quote.new_supply),
            "trade_type": ttype,
        }
    )

    # Big buy notification (only for influencer owner for now)
    notional = float(amount_f) * price
    if ttype == "buy" and notional >= 1000:
        notify_sync(
            user_id=influencer.owner_id,
            notif_type="notify.big_buy",
            message=f"Big buy: {amount_f:.2f} tokens at {price:.4f} (≈ {notional:.2f}).",
            data={"influencer_id": influencer.id, "trade_id": trade.id, "amount": amount_f, "price": price, "notional": notional},
        )

    return {"trade_id": trade.id, "price": price, "new_price": float(quote.new_price), "new_supply": float(quote.new_supply)}
