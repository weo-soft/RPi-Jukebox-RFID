import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import IconButton from '@mui/material/IconButton';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

const Header = ({ title, backLink }) => {
  const { t } = useTranslation();

  return (
    <Grid
      container
      size={12}
      spacing={1}
      sx={{
        alignItems: 'center',
        backgroundColor: 'background.default',
        minHeight: 56,
        position: 'sticky',
        top: 0,
        zIndex: 2,
      }}
    >
      {backLink &&
        <IconButton
          aria-label={t('header.back')}
          component={Link}
          nativeButton={false}
          sx={{
            height: 'var(--touch-comfort)',
            minHeight: 'var(--touch-comfort)',
            minWidth: 'var(--touch-comfort)',
            width: 'var(--touch-comfort)',
          }}
          title={t('header.back')}
          to={backLink}
        >
          <ArrowBackIcon />
        </IconButton>
      }
      <Typography component="h2" variant="sectionTitle">
        {title}
      </Typography>
    </Grid>
  );
};

export default Header;
