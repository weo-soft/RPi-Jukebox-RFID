import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  Button,
  Card,
  CardContent,
  FormControl,
  Grid,
  InputLabel,
  NativeSelect,
  Typography,
} from '@mui/material';

import { ORDERS } from './orders';

/*
 * The start area of a series: the source of the albums, the order the physical
 * stack is sorted in, the album the session begins with and the way into the
 * numbered list. It is the first state of the screen; the running session
 * leaves it behind and returns to it through its own control.
 */
const StartPanel = ({
  canStart,
  emptySource,
  memoryNumber,
  onContinue,
  onOpenList,
  onOrderChange,
  onProviderChange,
  onStart,
  orderId,
  provider,
  sources,
  startNumber,
  total,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-series-source" shrink>
                {t('cards.series.source')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-series-source' }}
                onChange={(event) => onProviderChange(event.target.value)}
                value={provider || ''}
              >
                {sources.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-series-order" shrink>
                {t('cards.series.order')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-series-order' }}
                onChange={(event) => onOrderChange(event.target.value)}
                value={orderId}
              >
                {ORDERS.map(({ id, labelKey }) => (
                  <option key={id} value={id}>{t(labelKey)}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          <Grid size={12}>
            {emptySource &&
              <>
                <Typography>{t('cards.series.empty-source')}</Typography>
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.series.empty-source-hint')}
                </Typography>
                <Button
                  component={Link}
                  nativeButton={false}
                  sx={{ marginTop: 'var(--space-2)' }}
                  to="/library"
                  variant="outlined"
                >
                  {t('cards.series.to-library')}
                </Button>
              </>
            }
            {!emptySource && canStart &&
              <Typography>
                {t('cards.series.start-at', { number: startNumber, total })}
              </Typography>
            }
            {!emptySource && !canStart &&
              <Typography>{t('cards.series.exhausted', { count: total })}</Typography>
            }
          </Grid>
          {memoryNumber > 0 &&
            <Grid
              container
              size={12}
              sx={{ alignItems: 'center', gap: 'var(--space-2)' }}
            >
              <Typography>
                {t('cards.series.last-at', { number: memoryNumber })}
              </Typography>
              <Button onClick={onContinue} variant="outlined">
                {t('cards.series.continue')}
              </Button>
            </Grid>
          }
          <Grid
            container
            size={12}
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          >
            <Button onClick={onOpenList} variant="outlined">
              {t('cards.series.open-list')}
            </Button>
            <Button disabled={!canStart} onClick={onStart} variant="contained">
              {t('cards.series.start')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default StartPanel;
