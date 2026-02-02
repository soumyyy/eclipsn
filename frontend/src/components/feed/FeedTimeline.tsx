import React from 'react';
import { motion } from 'framer-motion';
import { FeedCardProps } from './FeedCardRegistry';
import { BriefingCard } from './cards/BriefingCard';
import { VitalsCard } from './cards/VitalsCard';

interface FeedTimelineProps {
    cards: FeedCardProps[];
}

const FeedTimeline: React.FC<FeedTimelineProps> = ({ cards }) => {
    // Filter out recovery cards - they're now in the right panel
    const filteredCards = cards.filter(card => card.type !== 'recovery');

    return (
        <div className="space-y-6">
            {filteredCards.map((card, index) => (
                <TimelineItem key={card.id || index} card={card} index={index} />
            ))}
        </div>
    );
};

const TimelineItem: React.FC<{ card: FeedCardProps; index: number }> = ({ card, index }) => {
    const renderContent = () => {
        switch (card.type) {
            case 'briefing':
                return <BriefingCard data={card.data} />;
            case 'vitals':
                return <VitalsCard data={card.data} />;
            case 'insight':
                return (
                    <div className="card text-[var(--dutch-white-soft)] text-[15px] leading-relaxed">
                        {card.data?.text}
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="relative"
        >
            {renderContent()}
        </motion.div>
    );
};

export default FeedTimeline;
