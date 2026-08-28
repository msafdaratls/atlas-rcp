-- CreateIndex
CREATE INDEX "TariffEvaluation_technicalRegulationId_idx" ON "TariffEvaluation"("technicalRegulationId");

-- AddForeignKey
ALTER TABLE "TariffEvaluation" ADD CONSTRAINT "TariffEvaluation_technicalRegulationId_fkey" FOREIGN KEY ("technicalRegulationId") REFERENCES "TechnicalRegulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
