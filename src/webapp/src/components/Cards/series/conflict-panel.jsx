import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
} from '@mui/material';

import { describeText } from '../describe';

/*
 * A card that is already registered. Re-hanging is offered for album cards
 * only; a folder, system or timer card belongs in the card list, so there the
 * message names the existing entry and leads there with the id as search term.
 */
const ConflictPanel = ({
  canRebind,
  cardId,
  existing,
  onClose,
  onRebind,
}) => {
  const { t } = useTranslation();
  const content = describeText(existing)
    || (existing.from_alias
      ? t(
          `cards.controls.command-selector.commands.${existing.from_alias}`,
          { defaultValue: existing.from_alias },
        )
      : t('cards.series.conflict-unknown'));

  return (
    <Card elevation={0}>
      <CardContent>
        <Typography>
          {t('cards.series.conflict', { cardId, content })}
        </Typography>
        <Grid
          container
          sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
        >
          <Button onClick={onClose} variant="outlined">
            {t('cards.series.dismiss')}
          </Button>
          {canRebind
            ? <Button onClick={onRebind} variant="contained">
                {t('cards.series.rebind')}
              </Button>
            : <Button
                component={Link}
                nativeButton={false}
                to={`/cards?search=${encodeURIComponent(cardId)}`}
                variant="contained"
              >
                {t('cards.series.conflict-list')}
              </Button>
          }
        </Grid>
      </CardContent>
    </Card>
  );
};

export default ConflictPanel;
