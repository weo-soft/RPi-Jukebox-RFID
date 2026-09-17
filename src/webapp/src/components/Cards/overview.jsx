import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import CardsList from './list';
import CircularProgress from '@mui/material/CircularProgress';
import Fab from '@mui/material/Fab';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import Header from '../Header';
import request from '../../utils/request';

const CardsOverview = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [data, setData] = useState({});
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const openRegisterCard = () => {
    navigate('register');
  };

  useEffect(() => {
    const loadCardList = async () => {
      setIsLoading(true);
      const { result, error } = await request('cardsList');
      setIsLoading(false);

      if(result) setData(result);
      if(error) setError(error);
    }

    loadCardList();
  }, []);

  return (
    <Grid container id="cards" size={12}>
      <Header title={t('cards.overview.cards')} />
      <Grid
        container
        size={12}
        spacing={1}
        sx={{
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {isLoading
          ? <CircularProgress />
          : <CardsList cardsList={data} />
        }
        {error &&
          <Typography>{t('cards.overview.loading-error')}</Typography>
        }
      </Grid>
      <Fab
        aria-label={t('cards.overview.register-card')}
        color="primary"
        onClick={openRegisterCard}
        sx={{
          bottom: 'calc(var(--nav-height) + var(--space-4))',
          height: 'var(--touch-secondary)',
          minHeight: 'var(--touch-secondary)',
          position: 'fixed',
          right: 'var(--gutter)',
          width: 'var(--touch-secondary)',
        }}
      >
        <AddIcon />
      </Fab>
    </Grid>
  );
};

export default CardsOverview;
