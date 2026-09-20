function zero(value) {
  return value ?? '0.00';
}

export function iniciarBaseDeDatosReports(pool) {
  return {
    async obtenerDashboard(tenantId, businessDate) {
      const [financialRows] = await pool.execute(
        `SELECT ca.current_balance AS currentBalance,
                COALESCE(SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END),0) AS ledgerBalance,
                COALESCE(SUM(CASE WHEN cm.business_date<? AND cm.direction='CREDIT' THEN cm.amount
                                  WHEN cm.business_date<? AND cm.direction='DEBIT' THEN -cm.amount ELSE 0 END),0) AS openingBalance,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.movement_type='SALE' THEN cm.amount ELSE 0 END),0) AS grossSalesAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.movement_type='CANCELLATION' THEN cm.amount ELSE 0 END),0) AS cancelledSalesAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.movement_type='PRIZE_PAYMENT' THEN cm.amount ELSE 0 END),0) AS paidPrizesAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.movement_type='EXPENSE' THEN cm.amount ELSE 0 END),0) AS expensesAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.direction='CREDIT' AND cm.movement_type IN ('INITIAL','ENTRY') THEN cm.amount ELSE 0 END),0) AS cashEntriesAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.direction='DEBIT' AND cm.movement_type='WITHDRAWAL' THEN cm.amount ELSE 0 END),0) AS cashWithdrawalsAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.direction='CREDIT' AND cm.movement_type='ADJUSTMENT' THEN cm.amount ELSE 0 END),0) AS adjustmentCreditsAmount,
                COALESCE(SUM(CASE WHEN cm.business_date=? AND cm.direction='DEBIT' AND cm.movement_type='ADJUSTMENT' THEN cm.amount ELSE 0 END),0) AS adjustmentDebitsAmount
         FROM cash_accounts ca
         LEFT JOIN cash_movements cm ON cm.cash_account_id=ca.id AND cm.tenant_id=ca.tenant_id
         WHERE ca.tenant_id=? GROUP BY ca.id`,
        [businessDate, businessDate, businessDate, businessDate, businessDate,
          businessDate, businessDate, businessDate, businessDate, businessDate, tenantId],
      );
      const [prizeRows] = await pool.execute(
        `SELECT COALESCE(SUM(e.prize_amount),0) AS generatedPrizesAmount,
                COALESCE(SUM(CASE WHEN pp.id IS NULL THEN e.prize_amount ELSE 0 END),0) AS pendingPrizesAmount,
                COALESCE(SUM(CASE WHEN pp.id IS NULL AND e.is_winner=TRUE THEN 1 ELSE 0 END),0) AS pendingPrizeCount
         FROM draws d
         JOIN ticket_prize_evaluations e
           ON e.draw_id=d.id AND e.result_version_id=d.current_result_version_id AND e.is_winner=TRUE
         LEFT JOIN prize_payments pp ON pp.ticket_id=e.ticket_id
         WHERE d.tenant_id=? AND d.business_date=?`,
        [tenantId, businessDate],
      );
      const [exposureRows] = await pool.execute(
        `SELECT COALESCE(SUM(draw_exposure),0) AS openExposureAmount
         FROM (
           SELECT exposure.draw_id,MAX(exposure.number_exposure) AS draw_exposure
           FROM (
             SELECT ti.draw_id,ti.number_value,SUM(ti.potential_prize_amount) AS number_exposure
             FROM ticket_items ti
             JOIN tickets t ON t.id=ti.ticket_id AND t.tenant_id=ti.tenant_id AND t.status='VALID'
             JOIN draws d ON d.id=ti.draw_id AND d.tenant_id=ti.tenant_id
             WHERE ti.tenant_id=? AND d.business_date=?
               AND d.status IN ('OPEN','CLOSED') AND d.current_result_version_id IS NULL
             GROUP BY ti.draw_id,ti.number_value
           ) exposure GROUP BY exposure.draw_id
         ) open_draws`,
        [tenantId, businessDate],
      );
      const [ticketRows] = await pool.execute(
        'SELECT COUNT(*) AS ticketCount FROM tickets WHERE tenant_id=? AND business_date=?',
        [tenantId, businessDate],
      );
      const [upcomingDraws] = await pool.execute(
        `SELECT public_id AS drawPublicId,lottery_name_snapshot AS lotteryName,
                modality_name_snapshot AS modalityName,scheduled_at_utc AS scheduledAt,
                closes_at_utc AS closesAt
         FROM draws WHERE tenant_id=? AND business_date=? AND status='OPEN'
           AND closes_at_utc>UTC_TIMESTAMP(6)
         ORDER BY closes_at_utc,id LIMIT 5`,
        [tenantId, businessDate],
      );
      const [refundRows] = (await pool.execute(
        `SELECT COALESCE(SUM(tc.cancelled_amount),0) AS pendingRefundAmount,
                COUNT(*) AS pendingRefundCount
         FROM ticket_cancellations tc
         JOIN tickets t ON t.id=tc.ticket_id AND t.tenant_id=tc.tenant_id
         LEFT JOIN ticket_replacements tr ON tr.original_ticket_id=tc.ticket_id
         WHERE tc.tenant_id=? AND t.business_date=? AND tr.id IS NULL`,
        [tenantId, businessDate],
      )) || [[]];
      const financial = financialRows[0] || {};
      return {
        currentBalance: zero(financial.currentBalance),
        ledgerBalance: zero(financial.ledgerBalance),
        openingBalance: zero(financial.openingBalance),
        grossSalesAmount: zero(financial.grossSalesAmount),
        cancelledSalesAmount: zero(financial.cancelledSalesAmount),
        paidPrizesAmount: zero(financial.paidPrizesAmount),
        expensesAmount: zero(financial.expensesAmount),
        cashEntriesAmount: zero(financial.cashEntriesAmount),
        cashWithdrawalsAmount: zero(financial.cashWithdrawalsAmount),
        adjustmentCreditsAmount: zero(financial.adjustmentCreditsAmount),
        adjustmentDebitsAmount: zero(financial.adjustmentDebitsAmount),
        generatedPrizesAmount: zero(prizeRows[0]?.generatedPrizesAmount),
        pendingPrizesAmount: zero(prizeRows[0]?.pendingPrizesAmount),
        pendingPrizeCount: Number(prizeRows[0]?.pendingPrizeCount || 0),
        pendingRefundAmount: zero(refundRows[0]?.pendingRefundAmount),
        pendingRefundCount: Number(refundRows[0]?.pendingRefundCount || 0),
        openExposureAmount: zero(exposureRows[0]?.openExposureAmount),
        ticketCount: Number(ticketRows[0]?.ticketCount || 0),
        upcomingDraws,
      };
    },

    async listarSorteosRealizados(tenantId, businessDate, cursor, limit) {
      const filters = ["d.tenant_id=?", 'd.business_date=?', 'd.current_result_version_id IS NOT NULL'];
      const parameters = [tenantId, businessDate];
      if (cursor) {
        filters.push('(d.scheduled_at_utc<? OR (d.scheduled_at_utc=? AND d.id<?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT d.id,d.public_id AS drawPublicId,d.scheduled_at_utc AS createdAt,
                d.lottery_name_snapshot AS lotteryName,d.modality_name_snapshot AS modalityName,
                DATE_FORMAT(d.business_date,'%Y-%m-%d') AS businessDate,
                d.total_sold_amount AS totalSoldAmount,LPAD(rv.winning_number,2,'0') AS winningNumber,
                COALESCE(SUM(e.is_winner),0) AS winningTicketCount,
                COALESCE(SUM(e.prize_amount),0) AS generatedPrizesAmount,
                COALESCE(SUM(CASE WHEN e.is_winner=TRUE AND pp.id IS NULL THEN e.prize_amount ELSE 0 END),0) AS pendingPrizesAmount,
                COALESCE(SUM(CASE WHEN pp.id IS NOT NULL THEN e.prize_amount ELSE 0 END),0) AS paidPrizesAmount
         FROM draws d
         JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
         LEFT JOIN ticket_prize_evaluations e ON e.result_version_id=rv.id
         LEFT JOIN prize_payments pp ON pp.evaluation_id=e.id
         WHERE ${filters.join(' AND ')}
         GROUP BY d.id,rv.id
         ORDER BY d.scheduled_at_utc DESC,d.id DESC LIMIT ?`,
        parameters,
      );
      return rows.map((row) => ({
        ...row, id: String(row.id), winningTicketCount: Number(row.winningTicketCount),
      }));
    },

    async listarGanadores(tenantId, drawPublicId, cursor, limit) {
      const [drawRows] = await pool.execute(
        `SELECT d.id,d.public_id AS drawPublicId,d.lottery_name_snapshot AS lotteryName,
                d.modality_name_snapshot AS modalityName,LPAD(rv.winning_number,2,'0') AS winningNumber
         FROM draws d JOIN draw_result_versions rv ON rv.id=d.current_result_version_id
         WHERE d.tenant_id=? AND d.public_id=? LIMIT 1`,
        [tenantId, drawPublicId],
      );
      if (!drawRows[0]) return null;
      const filters = ['e.tenant_id=?', 'e.draw_id=?', 'e.result_version_id=d.current_result_version_id', 'e.is_winner=TRUE'];
      const parameters = [tenantId, drawRows[0].id];
      if (cursor) {
        filters.push('(t.created_at<? OR (t.created_at=? AND t.id<?))');
        parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
      }
      parameters.push(limit);
      const [rows] = await pool.execute(
        `SELECT t.id,t.public_code AS ticketCode,t.created_at AS createdAt,
                t.seller_name_snapshot AS sellerName,LPAD(e.winning_number,2,'0') AS winningNumber,
                e.winning_bet_amount AS winningBetAmount,e.multiplier_snapshot AS multiplier,
                e.prize_amount AS prizeAmount,
                CASE WHEN pp.id IS NULL THEN 'PENDING_PAYMENT' ELSE 'PAID' END AS prizeStatus,
                pp.paid_at AS paidAt
         FROM ticket_prize_evaluations e
         JOIN draws d ON d.id=e.draw_id AND d.tenant_id=e.tenant_id
         JOIN tickets t ON t.id=e.ticket_id AND t.tenant_id=e.tenant_id
         LEFT JOIN prize_payments pp ON pp.evaluation_id=e.id
         WHERE ${filters.join(' AND ')}
         ORDER BY t.created_at DESC,t.id DESC LIMIT ?`,
        parameters,
      );
      return { draw: drawRows[0], rows: rows.map((row) => ({ ...row, id: String(row.id) })) };
    },

    async obtenerReporteDiario(tenantId, dateFrom, dateTo) {
      const [rows] = await pool.execute(
        `WITH RECURSIVE report_dates AS (
           SELECT CAST(? AS DATE) AS business_date
           UNION ALL SELECT DATE_ADD(business_date,INTERVAL 1 DAY)
           FROM report_dates WHERE business_date<?
         ), number_exposure AS (
           SELECT open_draw.business_date,ti.draw_id,ti.number_value,
                  SUM(ti.potential_prize_amount) AS amount
           FROM ticket_items ti
           JOIN tickets t ON t.id=ti.ticket_id AND t.tenant_id=ti.tenant_id AND t.status='VALID'
           JOIN draws open_draw ON open_draw.id=ti.draw_id AND open_draw.tenant_id=ti.tenant_id
           WHERE ti.tenant_id=? AND open_draw.current_result_version_id IS NULL
             AND open_draw.status IN ('OPEN','CLOSED')
           GROUP BY open_draw.business_date,ti.draw_id,ti.number_value
         ), draw_exposure AS (
           SELECT business_date,draw_id,MAX(amount) AS amount
           FROM number_exposure GROUP BY business_date,draw_id
         ), date_exposure AS (
           SELECT business_date,SUM(amount) AS amount
           FROM draw_exposure GROUP BY business_date
         )
         SELECT DATE_FORMAT(rd.business_date,'%Y-%m-%d') AS businessDate,
                COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date AND cm.movement_type='SALE'),0) AS grossSalesAmount,
                COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date AND cm.movement_type='CANCELLATION'),0) AS cancelledSalesAmount,
                COALESCE((SELECT SUM(CASE WHEN cm.movement_type='SALE' THEN cm.amount WHEN cm.movement_type='CANCELLATION' THEN -cm.amount ELSE 0 END) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date),0) AS netSalesAmount,
                COALESCE((SELECT SUM(e.prize_amount) FROM draws d JOIN ticket_prize_evaluations e ON e.draw_id=d.id AND e.result_version_id=d.current_result_version_id AND e.is_winner=TRUE WHERE d.tenant_id=? AND d.business_date=rd.business_date),0) AS generatedPrizesAmount,
                COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date AND cm.movement_type='PRIZE_PAYMENT'),0) AS paidPrizesAmount,
                COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date AND cm.movement_type='EXPENSE'),0) AS expensesAmount,
                COALESCE((SELECT SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date=rd.business_date AND cm.movement_type='ADJUSTMENT'),0) AS adjustmentsNetAmount,
                COALESCE((SELECT SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date<rd.business_date),0) AS openingBalance,
                COALESCE((SELECT SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END) FROM cash_movements cm WHERE cm.tenant_id=? AND cm.business_date<=rd.business_date),0) AS closingBalance,
                COALESCE(de.amount,0) AS openExposureAmount,
                tds.status AS snapshotStatus,tds.calculation_version AS snapshotVersion
         FROM report_dates rd
         LEFT JOIN date_exposure de ON de.business_date=rd.business_date
         LEFT JOIN tenant_daily_summaries tds ON tds.tenant_id=? AND tds.business_date=rd.business_date
         ORDER BY rd.business_date`,
        [dateFrom, dateTo, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId,
          tenantId, tenantId, tenantId, tenantId, tenantId],
      );
      return rows.map((row) => ({
        ...row, snapshotVersion: row.snapshotVersion == null ? null : Number(row.snapshotVersion),
      }));
    },

    async obtenerConciliacion(tenantId, businessDate) {
      const [cashRows] = await pool.execute(
        `SELECT ca.current_balance AS cachedBalance,
                COALESCE(SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END),0) AS ledgerBalance,
                CAST(ca.current_balance-COALESCE(SUM(CASE WHEN cm.direction='CREDIT' THEN cm.amount ELSE -cm.amount END),0) AS DECIMAL(15,2)) AS difference
         FROM cash_accounts ca LEFT JOIN cash_movements cm ON cm.cash_account_id=ca.id
         WHERE ca.tenant_id=? GROUP BY ca.id`, [tenantId],
      );
      const [ticketRows] = await pool.execute(
        `SELECT COUNT(*) AS differenceCount
         FROM draws d
         LEFT JOIN (SELECT draw_id,SUM(total_amount) AS ticketTotal,COUNT(*) AS ticketCount
                    FROM tickets WHERE tenant_id=? AND status='VALID' GROUP BY draw_id) t ON t.draw_id=d.id
         WHERE d.tenant_id=? AND d.business_date=?
           AND (d.total_sold_amount<>COALESCE(t.ticketTotal,0) OR d.valid_ticket_count<>COALESCE(t.ticketCount,0))`,
        [tenantId, tenantId, businessDate],
      );
      const [positionRows] = await pool.execute(
        `SELECT COUNT(*) AS differenceCount FROM draw_number_positions p
         JOIN draws d ON d.id=p.draw_id
         LEFT JOIN (SELECT ti.draw_id,ti.number_value,SUM(ti.bet_amount) AS sold,COUNT(*) AS tickets
                    FROM ticket_items ti JOIN tickets t ON t.id=ti.ticket_id AND t.status='VALID'
                    WHERE ti.tenant_id=? GROUP BY ti.draw_id,ti.number_value) x
           ON x.draw_id=p.draw_id AND x.number_value=p.number_value
         WHERE d.tenant_id=? AND d.business_date=?
           AND (p.sold_amount<>COALESCE(x.sold,0) OR p.valid_ticket_count<>COALESCE(x.tickets,0))`,
        [tenantId, tenantId, businessDate],
      );
      const [prizeRows] = await pool.execute(
        `SELECT COUNT(*) AS differenceCount FROM ticket_prize_evaluations e
         JOIN draws d ON d.id=e.draw_id AND d.current_result_version_id=e.result_version_id
         LEFT JOIN ticket_items ti ON ti.ticket_id=e.ticket_id AND ti.number_value=e.winning_number
         WHERE e.tenant_id=? AND d.business_date=? AND
           (e.is_winner<>(ti.id IS NOT NULL)
            OR e.winning_bet_amount<>COALESCE(ti.bet_amount,0)
            OR e.prize_amount<>COALESCE(ti.potential_prize_amount,0))`,
        [tenantId, businessDate],
      );
      const [paymentRows] = await pool.execute(
        `SELECT COUNT(*) AS differenceCount FROM (
           SELECT pp.id FROM prize_payments pp
           LEFT JOIN cash_movements cm ON cm.tenant_id=pp.tenant_id
             AND cm.movement_type='PRIZE_PAYMENT' AND cm.reference_type='TICKET'
             AND cm.reference_id=pp.ticket_id
           WHERE pp.tenant_id=?
             AND DATE(DATE_SUB(pp.paid_at,INTERVAL 6 HOUR))=?
             AND (cm.id IS NULL OR cm.amount<>pp.amount OR cm.direction<>'DEBIT')
           UNION ALL
           SELECT cm.id FROM cash_movements cm
           LEFT JOIN prize_payments pp ON pp.tenant_id=cm.tenant_id
             AND pp.ticket_id=cm.reference_id
           WHERE cm.tenant_id=? AND cm.business_date=?
             AND cm.movement_type='PRIZE_PAYMENT'
             AND (pp.id IS NULL OR pp.amount<>cm.amount OR cm.direction<>'DEBIT')
         ) differences`,
        [tenantId, businessDate, tenantId, businessDate],
      );
      const cash = cashRows[0] || { cachedBalance: '0.00', ledgerBalance: '0.00', difference: '0.00' };
      return {
        cash,
        tickets: { differenceCount: Number(ticketRows[0].differenceCount) },
        positions: { differenceCount: Number(positionRows[0].differenceCount) },
        prizes: { differenceCount: Number(prizeRows[0].differenceCount) },
        payments: { differenceCount: Number(paymentRows[0].differenceCount) },
      };
    },
  };
}
