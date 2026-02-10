"""Market data endpoints (MVP off-chain).

Provides token state, orderbook-style quotes (bonding curve depth), user
positions, and recent trade tape.

This is not a true orderbook (no limit orders). Instead, we present buy/sell
depth computed from the pricing curve to give users a familiar market UI.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..auth import get_current_active_user
from ..database import SessionLocal
from ..pricing import get_or_create_state, quote_trade


router = APIRouter(prefix="/market", tags=["market"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/tokens")
def list_tokens(db: Session = Depends(get_db), skip: int = 0, limit: int = 50):
    """List tokenized influencers with current price/supply."""
    limit = min(max(limit, 1), 100)

    influencers = (
        db.query(models.Influencer)
        .order_by(models.Influencer.id.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    out: list[dict[str, Any]] = []
    for inf in influencers:
        state = get_or_create_state(db, inf.id)
        follower_count = (
            db.query(models.Follow)
            .filter(models.Follow.influencer_id == inf.id)
            .count()
        )
        out.append(
            {
                "influencer_id": inf.id,
                "name": inf.name,
                "niche": inf.niche,
                "style": inf.style,
                "price": float(state.price),
                "supply": float(state.supply),
                "followers": int(follower_count),
                "updated_at": state.updated_at.isoformat() if state.updated_at else None,
            }
        )
    db.flush()
    return out


@router.get("/tokens/{influencer_id}")
def token_detail(influencer_id: int, db: Session = Depends(get_db)):
    """Return token state for one influencer."""
    inf = db.query(models.Influencer).filter(models.Influencer.id == influencer_id).first()
    if not inf:
        raise HTTPException(status_code=404, detail="Influencer not found")
    state = get_or_create_state(db, influencer_id)
    follower_count = db.query(models.Follow).filter(models.Follow.influencer_id == influencer_id).count()
    return {
        "influencer_id": inf.id,
        "name": inf.name,
        "niche": inf.niche,
        "style": inf.style,
        "bio": inf.bio,
        "price": float(state.price),
        "supply": float(state.supply),
        "followers": int(follower_count),
        "updated_at": state.updated_at.isoformat() if state.updated_at else None,
    }


@router.get("/orderbook/{influencer_id}")
def orderbook(influencer_id: int, db: Session = Depends(get_db), levels: int = 6):
    """Return orderbook-style depth from bonding curve quotes."""
    inf = db.query(models.Influencer).filter(models.Influencer.id == influencer_id).first()
    if not inf:
        raise HTTPException(status_code=404, detail="Influencer not found")

    state = get_or_create_state(db, influencer_id)
    base_amounts = [Decimal("1"), Decimal("2"), Decimal("5"), Decimal("10"), Decimal("25"), Decimal("50"), Decimal("100")]
    base_amounts = base_amounts[: max(1, min(levels, len(base_amounts)))]

    asks = []
    bids = []
    for amt in base_amounts:
        q_buy = quote_trade(state.supply, amt, "buy")
        asks.append({"amount": float(amt), "avg_price": float(q_buy.avg_price), "new_price": float(q_buy.new_price)})

        # For sells, clamp amount to current supply to avoid invalid quotes
        sell_amt = amt if amt <= state.supply else state.supply
        if sell_amt > 0:
            q_sell = quote_trade(state.supply, sell_amt, "sell")
            bids.append({"amount": float(sell_amt), "avg_price": float(q_sell.avg_price), "new_price": float(q_sell.new_price)})

    return {
        "influencer_id": influencer_id,
        "asks": asks,
        "bids": bids,
        "timestamp": datetime.utcnow().isoformat(),
        "current_price": float(state.price),
        "current_supply": float(state.supply),
    }


@router.get("/position/{influencer_id}")
def position(
    influencer_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Return the current user's token position for an influencer."""
    rows = (
        db.query(models.WalletLedger.amount)
        .filter(models.WalletLedger.user_id == current_user.id, models.WalletLedger.influencer_id == influencer_id)
        .all()
    )
    balance = sum(Decimal(str(r[0])) for r in rows) if rows else Decimal("0")

    # Weighted avg buy price based on BUY trades
    buys = (
        db.query(models.Trade.amount, models.Trade.price)
        .filter(
            models.Trade.user_id == current_user.id,
            models.Trade.influencer_id == influencer_id,
            models.Trade.trade_type == "buy",
        )
        .all()
    )
    notional = sum(Decimal(str(a)) * Decimal(str(p)) for a, p in buys) if buys else Decimal("0")
    qty = sum(Decimal(str(a)) for a, _ in buys) if buys else Decimal("0")
    avg_buy_price = (notional / qty) if qty > 0 else None

    return {"influencer_id": influencer_id, "balance": float(balance), "avg_buy_price": float(avg_buy_price) if avg_buy_price is not None else None}


@router.get("/tape/{influencer_id}")
def recent_trades(influencer_id: int, db: Session = Depends(get_db), limit: int = 30):
    """Recent trade tape for an influencer."""
    limit = min(max(limit, 1), 200)
    trades = (
        db.query(models.Trade)
        .filter(models.Trade.influencer_id == influencer_id)
        .order_by(models.Trade.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": t.id,
            "user_id": t.user_id,
            "amount": float(t.amount),
            "price": float(t.price),
            "trade_type": t.trade_type,
            "timestamp": t.timestamp.isoformat() if t.timestamp else None,
        }
        for t in trades
    ]
