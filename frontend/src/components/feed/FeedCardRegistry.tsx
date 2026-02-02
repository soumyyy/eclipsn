import { BriefingCard } from './cards/BriefingCard';
import { WhoopCard } from './cards/WhoopCard';
import { VitalsCard } from './cards/VitalsCard';
// import { AgendaCard } from './cards/AgendaCard';
// import { InsightCard } from './cards/InsightCard';

export type FeedCardType = 'briefing' | 'agenda' | 'insight' | 'stat' | 'recovery' | 'vitals';

export interface FeedCardProps {
    id: string;
    type: FeedCardType;
    data: any;
    priority: number;
    timestamp?: string;
}

export function FeedCardRegistry({ card }: { card: FeedCardProps }) {
    switch (card.type) {
        case 'briefing':
            return <BriefingCard data={card.data} />;
        case 'recovery':
            return <WhoopCard data={card.data} />;
        case 'vitals':
            return <VitalsCard data={card.data} />;
        // case 'agenda':
        //   return <AgendaCard data={card.data} />;
        default:
            return (
                <div className="p-4 rounded border border-primary/30 bg-primary/5 text-primary/70 font-mono text-xs">
                    Unknown Card Type: {card.type}
                </div>
            );
    }
}
