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
  emptySelection,
  emptySource,
  isSelected,
  memoryNumber,
  missingCount,
  mode,
  onChoose,
  onClearSelection,
  onContinue,
  onModeChange,
  onOpenList,
  onOrderChange,
  onProviderChange,
  onStart,
  openAlbums,
  orderId,
  provider,
  selectedCount,
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
                sx={{ '& select': { height: 'var(--touch-min)' } }}
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
                sx={{ '& select': { height: 'var(--touch-min)' } }}
                value={orderId}
              >
                {ORDERS.map(({ id, labelKey }) => (
                  <option key={id} value={id}>{t(labelKey)}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-series-mode" shrink>
                {t('cards.series.mode')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-series-mode' }}
                onChange={(event) => onModeChange(event.target.value)}
                sx={{ '& select': { height: 'var(--touch-min)' } }}
                value={mode}
              >
                <option value="guided">{t('cards.series.modes.guided')}</option>
                <option value="free">{t('cards.series.modes.free')}</option>
              </NativeSelect>
            </FormControl>
          </Grid>
          {mode === 'guided' && !emptySource &&
            <Grid size={{ md: 6, xs: 12 }}>
              <Typography variant="contentBody">{t('cards.series.selection')}</Typography>
              <Typography color="textSecondary" variant="contentBody">
                {isSelected
                  ? t('cards.series.choice.selected', { count: selectedCount, open: openAlbums })
                  : t('cards.series.choice.selected-all')
                }
              </Typography>
              {missingCount > 0 &&
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.series.choice.missing', { count: missingCount })}
                </Typography>
              }
              <Grid container sx={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <Button onClick={onChoose} variant="outlined">
                  {isSelected ? t('cards.series.choice.change') : t('cards.series.choice.title')}
                </Button>
                {isSelected &&
                  <Button onClick={onClearSelection} variant="outlined">
                    {t('cards.series.choice.clear')}
                  </Button>
                }
              </Grid>
            </Grid>
          }
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
            {!emptySource && emptySelection &&
              <>
                <Typography>{t('cards.series.choice.empty')}</Typography>
                <Typography color="textSecondary" variant="contentBody">
                  {t('cards.series.choice.empty-hint')}
                </Typography>
              </>
            }
            {!emptySource && !emptySelection && canStart &&
              <Typography>
                {t('cards.series.start-at', { number: startNumber, total })}
              </Typography>
            }
            {!emptySource && !emptySelection && !canStart &&
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
              {mode === 'free' ? t('cards.series.start-free') : t('cards.series.start')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default StartPanel;
