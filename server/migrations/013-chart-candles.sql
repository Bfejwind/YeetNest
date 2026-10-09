ALTER TABLE indexed_trades ADD COLUMN IF NOT EXISTS venue TEXT NOT NULL DEFAULT 'curve';
CREATE TABLE chart_candles (
  mint TEXT NOT NULL, time BIGINT NOT NULL,
  open NUMERIC NOT NULL, high NUMERIC NOT NULL, low NUMERIC NOT NULL, close NUMERIC NOT NULL,
  volume NUMERIC NOT NULL, trades BIGINT NOT NULL,
  first_key TEXT NOT NULL, last_key TEXT NOT NULL,
  PRIMARY KEY(mint,time)
);
CREATE TABLE chart_exchange_rates (
  time BIGINT PRIMARY KEY, usd NUMERIC NOT NULL CHECK(usd>0), source TEXT NOT NULL, observed BIGINT NOT NULL
);
CREATE FUNCTION update_chart_candle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE token indexed_launches%ROWTYPE; price NUMERIC; volume NUMERIC; stamp BIGINT; ordering TEXT;
BEGIN
  IF NEW.block_time IS NULL OR NEW.base_amount<=0 OR NEW.quote_amount<=0 THEN RETURN NEW; END IF;
  SELECT * INTO token FROM indexed_launches WHERE pool=NEW.pool;
  price := NEW.quote_amount/power(10::numeric,9)/(NEW.base_amount/power(10::numeric,token.decimals));
  volume := NEW.quote_amount/power(10::numeric,9);
  stamp := floor(NEW.block_time/60)*60;
  ordering := lpad(NEW.slot::text,20,'0') || ':' || NEW.signature || ':' ||
    CASE WHEN NEW.event_index LIKE 'cpi:%' THEN lpad(split_part(NEW.event_index,':',2),8,'0') || ':' || lpad(split_part(NEW.event_index,':',3),8,'0')
    ELSE lpad(split_part(NEW.event_index,':',2),8,'0') END;
  INSERT INTO chart_candles VALUES(token.mint,stamp,price,price,price,price,volume,1,ordering,ordering)
  ON CONFLICT(mint,time) DO UPDATE SET
    open=CASE WHEN EXCLUDED.first_key<chart_candles.first_key THEN EXCLUDED.open ELSE chart_candles.open END,
    close=CASE WHEN EXCLUDED.last_key>chart_candles.last_key THEN EXCLUDED.close ELSE chart_candles.close END,
    high=greatest(chart_candles.high,EXCLUDED.high),low=least(chart_candles.low,EXCLUDED.low),
    volume=chart_candles.volume+EXCLUDED.volume,trades=chart_candles.trades+1,
    first_key=least(chart_candles.first_key,EXCLUDED.first_key),last_key=greatest(chart_candles.last_key,EXCLUDED.last_key);
  RETURN NEW;
END $$;
CREATE TRIGGER chart_trade_insert AFTER INSERT ON indexed_trades FOR EACH ROW EXECUTE FUNCTION update_chart_candle();
INSERT INTO chart_candles
SELECT l.mint,floor(t.block_time/60)*60,
 (array_agg(t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals)) ORDER BY t.slot,t.signature,split_part(t.event_index,':',2)::int,COALESCE(NULLIF(split_part(t.event_index,':',3),''),'0')::int))[1],
 max(t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals))),
 min(t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals))),
 (array_agg(t.quote_amount/power(10::numeric,9)/(t.base_amount/power(10::numeric,l.decimals)) ORDER BY t.slot DESC,t.signature DESC,split_part(t.event_index,':',2)::int DESC,COALESCE(NULLIF(split_part(t.event_index,':',3),''),'0')::int DESC))[1],
 sum(t.quote_amount/power(10::numeric,9)),count(*),
 min(lpad(t.slot::text,20,'0')||':'||t.signature||':'||CASE WHEN t.event_index LIKE 'cpi:%' THEN lpad(split_part(t.event_index,':',2),8,'0')||':'||lpad(split_part(t.event_index,':',3),8,'0') ELSE lpad(split_part(t.event_index,':',2),8,'0') END),
 max(lpad(t.slot::text,20,'0')||':'||t.signature||':'||CASE WHEN t.event_index LIKE 'cpi:%' THEN lpad(split_part(t.event_index,':',2),8,'0')||':'||lpad(split_part(t.event_index,':',3),8,'0') ELSE lpad(split_part(t.event_index,':',2),8,'0') END)
FROM indexed_trades t JOIN indexed_launches l ON l.pool=t.pool
WHERE t.block_time IS NOT NULL AND t.base_amount>0 AND t.quote_amount>0
GROUP BY l.mint,floor(t.block_time/60)*60;
