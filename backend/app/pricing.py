"""Off-chain token pricing engine (MVP).

For the MVP we use a simple linear bonding curve:

    p(s) = base + k * s

Where:
  - s is circulating supply
  - base is the initial price
  - k controls slope

When executing a buy/sell, we compute the *average* price paid along the curve
over the interval, update the supply, and set the current price to the
marginal price at the new supply.

This is deterministic, cheap, and removes the "client chooses the price" hack
so your charts are not pure fiction.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy.orm import Session

from . import models


BASE_PRICE = Decimal("1.0")
K = Decimal("0.0025")  # slope; adjust to taste


@dataclass
class TradeQuote:
    avg_price: Decimal
    new_price: Decimal
    new_supply: Decimal


def _to_dec(v) -> Decimal:
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def get_or_create_state(db: Session, influencer_id: int) -> models.InfluencerTokenState:
    state = db.query(models.InfluencerTokenState).filter(models.InfluencerTokenState.influencer_id == influencer_id).first()
    if state:
        return state
    state = models.InfluencerTokenState(influencer_id=influencer_id, price=BASE_PRICE, supply=Decimal("0"))
    db.add(state)
    db.flush()
    return state


def quote_trade(current_supply: Decimal, amount: Decimal, trade_type: str) -> TradeQuote:
    s = _to_dec(current_supply)
    a = _to_dec(amount)
    if a <= 0:
        raise ValueError("amount must be positive")
    t = (trade_type or "").lower()
    if t not in {"buy", "sell"}:
        raise ValueError("trade_type must be 'buy' or 'sell'")

    if t == "buy":
        # avg price = base + k*(2s + a)/2
        avg = BASE_PRICE + K * (2 * s + a) / 2
        new_supply = s + a
    else:
        if a > s:
            raise ValueError("cannot sell more than circulating supply")
        # average sell price over interval [s-a, s]
        avg = BASE_PRICE + K * (2 * (s - a) + a) / 2  # = base + k*(2s - a)/2
        new_supply = s - a

    new_price = BASE_PRICE + K * new_supply
    return TradeQuote(avg_price=avg, new_price=new_price, new_supply=new_supply)


def execute_trade(db: Session, influencer_id: int, amount: Decimal, trade_type: str) -> TradeQuote:
    """Update token state and return the quote used.

    This mutates the stored state. Caller is responsible for committing.
    """
    state = get_or_create_state(db, influencer_id)
    q = quote_trade(state.supply, amount, trade_type)
    state.supply = q.new_supply
    state.price = q.new_price
    db.add(state)
    return q
