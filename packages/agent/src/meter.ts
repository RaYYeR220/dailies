import { BudgetExceededError } from '@dailies/core';

export class CostMeter {
  private spentUsd = 0;

  constructor(private readonly limitUsd: number) {}

  add(usd: number): void {
    this.spentUsd += usd;
  }

  total(): number {
    return this.spentUsd;
  }

  assertWithin(): void {
    if (this.spentUsd > this.limitUsd) throw new BudgetExceededError(this.spentUsd, this.limitUsd);
  }
}
