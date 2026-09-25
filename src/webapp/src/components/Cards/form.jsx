import { useTranslation } from 'react-i18next';

import {
  Avatar,
  Card,
  CardContent,
  CardHeader,
  Grid,
  Typography,
} from '@mui/material';
import BookmarkIcon from '@mui/icons-material/Bookmark';

import Header from '../Header';
import CardIdField from './card-id-field';
import ActionsControls from './controls/actions-controls';
import ControlsSelector from './controls/controls-selector';

const InfoNoCardSwiped = () => {
  const { t } = useTranslation();

  return (
    <Typography>
      {t('cards.form.no-card-swiped')}
    </Typography>
  );
};

const CardsForm = ({
  title,
  cardId,
  onCardIdChange,
  actionData,
  setActionData,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <Header title={title} backLink="/cards" />
      <Grid container size={12}>
        <Grid size={12}>
          <Card elevation={0}>
            <CardHeader
              avatar={
                <Avatar aria-label={t('cards.form.no-card-swiped')}>
                  <BookmarkIcon />
                </Avatar>
              }
              slotProps={{
                subheader: { sx: { fontSize: 'var(--font-body)' } },
              }}
              subheader={t('cards.form.card-id-hint')}
              title={t('cards.card-id.label')}
            />
            <CardContent>
              <Grid container spacing={2}>
                <Grid size={12}>
                  {onCardIdChange
                    ? <CardIdField onChange={onCardIdChange} value={cardId || ''} />
                    : <Typography sx={{ fontFamily: 'monospace', fontSize: 18 }}>
                        {cardId}
                      </Typography>
                  }
                </Grid>
                {cardId &&
                  <>
                    <Grid size={{ md: 6, xs: 12 }}>
                      <ControlsSelector
                        actionData={actionData}
                        setActionData={setActionData}
                        cardId={cardId}
                      />
                    </Grid>
                    <Grid size={{ md: 6, xs: 12 }}>
                      <ActionsControls
                        actionData={actionData}
                        cardId={cardId}
                      />
                    </Grid>
                  </>
                }
                {!cardId && <Grid size={12}><InfoNoCardSwiped /></Grid>}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
};

export default CardsForm;
