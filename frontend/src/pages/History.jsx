/**
 * History Page — Full traceability dashboard for print batches.
 * Wraps PrintHistoryTab in a PageContainer with a clean PageHeader.
 */
import PrintHistoryTab from '../components/PrintHistoryTab'
import { Printer } from 'lucide-react'
import { PageContainer, PageHeader } from '../components/ui'

export default function History() {
    return (
        <PageContainer>
            <PageHeader
                title="Istoric Print"
                subtitle="Trasabilitate completă pentru toate batch-urile printate, KPI-uri și volum zilnic"
                icon={Printer}
            />
            <PrintHistoryTab />
        </PageContainer>
    )
}
