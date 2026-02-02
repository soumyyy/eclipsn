import React from 'react';
import { motion } from 'framer-motion';
import { FeedCardProps } from './FeedCardRegistry';
import { BriefingCard } from './cards/BriefingCard';

interface FeedTimelineProps {
    cards: FeedCardProps[];
}

const FeedTimeline: React.FC<FeedTimelineProps> = ({ cards }) => {
    // Filter out recovery cards - they're now in the right panel
    const filteredCards = cards.filter(card => card.type !== 'recovery');

    return (
        <div className="relative py-8 px-6 max-w-4xl mx-auto">
            <div className="space-y-0">
                {filteredCards.map((card, index) => (
                    <React.Fragment key={card.id || index}>
                        <TimelineItem card={card} index={index} />
                        {index < filteredCards.length - 1 && (
                            <div className="my-6 border-t border-white/5" />
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
};

const TimelineItem: React.FC<{ card: FeedCardProps; index: number }> = ({ card, index }) => {
    const renderContent = () => {
        switch (card.type) {
            case 'briefing':
                return <BriefingCard data={card.data} />;
            case 'insight':
                return (
                    <div className="text-white/70 text-sm leading-relaxed">
                        {card.data.text}
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
